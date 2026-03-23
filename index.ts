import {
  appendDailyLog,
  checkReviewResumability,
  getResolvedResearchMemoryPaths,
  getReviewState,
  recordExperimentEntry,
  recordFailedExperimentEntry,
  recordIdeaEntry,
  setReviewState,
} from "./tools/research-memory";
import {
  acknowledgeWorkflowMailboxMessage,
  bindChannelProjectForWorkflow,
  buildWorkflowSnapshot,
  canRoleContact,
  canRoleSpawn,
  checkGraphPresenceForWorkflow,
  ensureChannelProjectBindingForWorkflow,
  formatWorkflowSnapshotForPrompt,
  getChannelProjectBindingForWorkflow,
  getExperimentMemorySummary,
  getIdleResearchStateSummary,
  getInnovationReflectionStateSummary,
  getWritingContractStateSummary,
  getWorkflowContactCooldown,
  getProjectRootForWorkflow,
  getWorkflowGuardPolicy,
  inferTargetRoleFromToolParams,
  listChannelProjectBindingsForWorkflow,
  queueWorkflowMailboxMessage,
  recordInnovationReflection,
  recordWorkflowContactEvent,
  recordIdleResearchRun,
  recordCitationVerification,
  readWorkflowMailboxForAgent,
  runWorkflowAutoIterator,
  setIdleResearchState,
  setWritingContractState,
  sanitizeAgentMentions,
  sanitizeMessageToolParams,
  shouldBlockCoderDatasetMutation,
  shouldBlockInnovationWrite,
  shouldBlockProjectWrite,
  shouldBlockWriterTemplateWrite,
  unbindChannelProjectForWorkflow,
  upsertExperimentLedgerEntry,
  getCitationIntegrityStateSummary,
} from "./tools/workflow-guard";
import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
} from "./tools/agent-task-dispatch";

type ToolContext = {
  workspaceDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  sandboxed?: boolean;
};

type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (_id: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
};

type ApiLike = {
  config?: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  runtime?: {
    subagent?: {
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
  };
  registerTool: (
    spec: ToolSpec | ((ctx: ToolContext) => ToolSpec | null | undefined),
    options?: { optional?: boolean }
  ) => void;
  on?: (
    hookName: string,
    handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown,
    options?: { priority?: number }
  ) => void;
};

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function getPolicy(config: Record<string, unknown> | undefined) {
  return {
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    requireProjectIdInEntries: config?.requireProjectIdInEntries !== false,
    requireTrackId: config?.requireTrackId !== false,
    requireEvidencePointers: config?.requireEvidencePointers !== false,
    reviewStateMaxAgeHours:
      typeof config?.reviewStateMaxAgeHours === "number"
        ? config.reviewStateMaxAgeHours
        : 24,
    projectsRoot: readString(config?.projectsRoot),
    enableChannelProjectBindings: config?.enableChannelProjectBindings === true,
    channelProjectBindingsPath: readString(config?.channelProjectBindingsPath),
  };
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required for this action.`);
  }
  return value as T;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolvePluginConfig(api: ApiLike): Record<string, unknown> | undefined {
  return api.pluginConfig ?? api.config;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getToolContext(ctx: Record<string, unknown>): ToolContext {
  return {
    workspaceDir: readString(ctx.workspaceDir),
    agentId: readString(ctx.agentId),
    sessionKey: readString(ctx.sessionKey),
    sessionId: readString(ctx.sessionId),
    messageChannel: readString(ctx.messageChannel),
    sandboxed: ctx.sandboxed === true,
  };
}

async function maybeAutoBindChannelProject(params: {
  policy: ReturnType<typeof getWorkflowGuardPolicy>;
  agentCtx: ToolContext;
  snapshot: {
    projectRoot: string | null;
    projectId: string | null;
    projectResolutionSource: string;
    channelProjectBindingsEnabled: boolean;
  };
}) {
  if (!params.snapshot.channelProjectBindingsEnabled) {
    return;
  }
  if (!params.agentCtx.sessionKey && !params.agentCtx.sessionId) {
    return;
  }
  if (!params.snapshot.projectRoot) {
    return;
  }
  if (params.snapshot.projectResolutionSource === "channel_binding") {
    return;
  }
  await ensureChannelProjectBindingForWorkflow({
    policy: params.policy,
    workspaceDir: params.agentCtx.workspaceDir,
    sessionKey: params.agentCtx.sessionKey,
    sessionId: params.agentCtx.sessionId,
    messageChannel: params.agentCtx.messageChannel,
    projectRoot: params.snapshot.projectRoot,
    projectId: params.snapshot.projectId,
    boundByAgent: params.agentCtx.agentId ?? "workflow",
    notes: "Auto-created from a resolved project during workflow execution.",
  });
}

async function maybeDispatchAutoIteratorTask(params: {
  api: ApiLike;
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>;
  agentCtx: ToolContext;
  snapshot: {
    role: string | null;
    projectRoot: string | null;
    projectId: string | null;
    currentStage: string | null;
  };
  result: {
    ownerAfter: string | null;
    recommendedActions: Array<{
      kind: string;
      owner: string | null;
      stage: string | null;
      summary: string;
      command: string | null;
      mailboxMessageId: string | null;
      cooldownRemainingSeconds: number | null;
      blocking: boolean;
    }>;
  };
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
}) {
  const requesterRole = params.snapshot.role;
  const ownerAfter = params.result.ownerAfter as DispatchableWorkflowRole | null;
  if (!params.workflowPolicy.enforceWorkflowBoundaries) {
    return null;
  }
  if (!requesterRole || !ownerAfter || requesterRole === ownerAfter) {
    return null;
  }
  const primaryAction = params.result.recommendedActions.find(
    (action) => action.kind === "drive_stage" && action.owner === ownerAfter && !action.blocking
  );
  if (!primaryAction) {
    return null;
  }
  if ((primaryAction.cooldownRemainingSeconds ?? 0) > 0) {
    return {
      dispatched: false,
      blockedByCooldown: true,
      cooldownRemainingSeconds: primaryAction.cooldownRemainingSeconds,
      owner: ownerAfter,
    };
  }
  if (!params.snapshot.projectRoot) {
    return null;
  }
  const dispatch = await dispatchWorkflowTaskToAgent({
    runtimeSubagent: params.api.runtime?.subagent,
    requesterSessionKey: params.agentCtx.sessionKey,
    requesterChannel: params.agentCtx.messageChannel,
    fromRole: requesterRole,
    toRole: ownerAfter,
    projectRoot: params.snapshot.projectRoot,
    projectId: params.snapshot.projectId,
    stage: primaryAction.stage ?? params.snapshot.currentStage,
    summary: primaryAction.summary,
    command: primaryAction.command,
    mailboxMessageId: primaryAction.mailboxMessageId,
    waitTimeoutMs: params.waitTimeoutMs,
    retryOnTimeout: params.retryOnTimeout,
    enableSpawnFallback: params.enableSpawnFallback,
  });
  if (dispatch.dispatched) {
    await recordWorkflowContactEvent({
      projectRoot: params.snapshot.projectRoot,
      fromAgent: requesterRole,
      toAgent: ownerAfter,
      channel: dispatch.channel ?? "sessions_send",
    });
  }
  return {
    ...dispatch,
    blockedByCooldown: false,
    cooldownRemainingSeconds: null,
    owner: ownerAfter,
  };
}

export default function registerOpenClawResearchPlugin(api: ApiLike) {
  const pluginConfig = resolvePluginConfig(api);

  api.registerTool(
    (ctx) => ({
      name: "research_memory",
      description:
        "Structured, project-isolated research memory tool. Use it instead of editing ideation-memory.md, experiment-memory.md, daily logs, or REVIEW_STATE.json by hand.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: [
              "get_paths",
              "record_idea_entry",
              "record_experiment_entry",
              "record_failed_experiment_entry",
              "append_daily_log",
              "get_review_state",
              "set_review_state",
              "check_review_resumability",
            ],
          },
          ideaEntry: {
            type: "object",
            additionalProperties: true,
          },
          experimentEntry: {
            type: "object",
            additionalProperties: true,
          },
          failedExperimentEntry: {
            type: "object",
            additionalProperties: true,
          },
          reviewState: {
            type: "object",
            additionalProperties: true,
          },
          dailyLog: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
      async execute(_id, params) {
        const policy = getPolicy(pluginConfig);
        const action = String(params.action ?? "");
        const toolCtx = {
          workspaceDir: ctx.workspaceDir,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          messageChannel: ctx.messageChannel,
        };

        switch (action) {
          case "get_paths": {
            const paths = getResolvedResearchMemoryPaths(policy, toolCtx);
            return textResponse(JSON.stringify(paths, null, 2));
          }
          case "record_idea_entry": {
            const result = await recordIdeaEntry(
              requireObject(params.ideaEntry, "ideaEntry"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "record_experiment_entry": {
            const result = await recordExperimentEntry(
              requireObject(params.experimentEntry, "experimentEntry"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "record_failed_experiment_entry": {
            const result = await recordFailedExperimentEntry(
              requireObject(
                params.failedExperimentEntry,
                "failedExperimentEntry"
              ),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "append_daily_log": {
            const result = await appendDailyLog(
              requireObject(params.dailyLog, "dailyLog"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "get_review_state": {
            const state = await getReviewState(policy, toolCtx);
            return textResponse(JSON.stringify(state, null, 2));
          }
          case "set_review_state": {
            const result = await setReviewState(
              requireObject(params.reviewState, "reviewState"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "check_review_resumability": {
            const result = await checkReviewResumability(policy, toolCtx);
            return textResponse(JSON.stringify(result, null, 2));
          }
          default:
            throw new Error(`Unsupported research_memory action: ${action}`);
        }
      },
    }),
    { optional: true }
  );

  api.registerTool(
    (ctx) => ({
      name: "research_workflow",
      description:
        "Project workflow guard, deterministic auto-iterator, idle research state, experiment ledger, innovation reflection, writing contract, citation integrity state, and mailbox. Use it to inspect current workflow state, reconcile and advance stages deterministically, keep structured background/experiment memory current, refresh experiment-informed ideation memory, persist template-driven writing constraints, record citation verification, read or send bounded handoff messages, and avoid direct edits to workflow state files.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: [
              "get_snapshot",
              "check_graph_presence",
              "auto_iterator_tick",
              "get_idle_research",
              "set_idle_research",
              "record_idle_research_run",
              "get_experiment_memory",
              "get_innovation_reflection",
              "get_writing_contract",
              "get_citation_integrity",
              "upsert_experiment",
              "record_innovation_reflection",
              "set_writing_contract",
              "record_citation_verification",
              "get_channel_project_binding",
              "bind_channel_project",
              "unbind_channel_project",
              "list_channel_project_bindings",
              "dispatch_task",
              "read_mailbox",
              "send_mailbox",
              "ack_mailbox",
            ],
          },
          idleResearch: {
            type: "object",
            additionalProperties: true,
          },
          iterator: {
            type: "object",
            additionalProperties: true,
          },
          graphPresenceCheck: {
            type: "object",
            additionalProperties: true,
          },
          idleResearchRun: {
            type: "object",
            additionalProperties: true,
          },
          experiment: {
            type: "object",
            additionalProperties: true,
          },
          innovationReflection: {
            type: "object",
            additionalProperties: true,
          },
          writingContract: {
            type: "object",
            additionalProperties: true,
          },
          citationVerification: {
            type: "object",
            additionalProperties: true,
          },
          channelBinding: {
            type: "object",
            additionalProperties: true,
          },
          toAgent: {
            type: "string",
          },
          subject: {
            type: "string",
          },
          body: {
            type: "string",
          },
          kind: {
            type: "string",
            enum: ["handoff", "blocker", "request", "note"],
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high"],
          },
          limit: {
            type: "number",
            minimum: 1,
          },
          includeAcknowledged: {
            type: "boolean",
          },
          messageId: {
            type: "string",
          },
          waitSeconds: {
            type: "number",
            minimum: 0,
          },
          retryOnTimeout: {
            type: "boolean",
          },
          enableSpawnFallback: {
            type: "boolean",
          },
        },
        required: ["action"],
      },
      async execute(_id, params) {
        const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
        const action = String(params.action ?? "");
        const channelBinding = asObject(params.channelBinding);
        const snapshot = await buildWorkflowSnapshot({
          policy: workflowPolicy,
          agentId: ctx.agentId,
          workspaceDir: ctx.workspaceDir,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          messageChannel: ctx.messageChannel,
          channelKey: readString(channelBinding?.channelKey),
        });
        await maybeAutoBindChannelProject({
          policy: workflowPolicy,
          agentCtx: ctx,
          snapshot,
        });
        const projectRoot =
          snapshot.projectRoot ??
          getProjectRootForWorkflow({
            policy: workflowPolicy,
            workspaceDir: ctx.workspaceDir,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.sessionId,
            messageChannel: ctx.messageChannel,
            channelKey: readString(channelBinding?.channelKey),
          });
        const projectRequiredMessage =
          "A resolved project is required for this workflow action. Bind the current Discord/channel session to a project or set OPENCLAW_PROJECT.";
        const bindingRole = snapshot.role ?? (ctx.agentId ? ctx.agentId.toLowerCase() : null);

        switch (action) {
          case "get_snapshot":
            return textResponse(JSON.stringify(snapshot, null, 2));
          case "check_graph_presence": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const graphPresenceCheck = asObject(params.graphPresenceCheck);
            const result = await checkGraphPresenceForWorkflow({
              projectRoot,
              updateManifest:
                graphPresenceCheck?.updateManifest === false ||
                graphPresenceCheck?.update_manifest === false
                  ? false
                  : true,
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "get_channel_project_binding": {
            const binding = getChannelProjectBindingForWorkflow({
              policy: workflowPolicy,
              workspaceDir: ctx.workspaceDir,
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              messageChannel: ctx.messageChannel,
              channelKey: readString(channelBinding?.channelKey),
            });
            return textResponse(JSON.stringify(binding, null, 2));
          }
          case "list_channel_project_bindings": {
            const bindings = listChannelProjectBindingsForWorkflow({
              policy: workflowPolicy,
              workspaceDir: ctx.workspaceDir,
            });
            return textResponse(JSON.stringify(bindings, null, 2));
          }
          case "bind_channel_project": {
            if (bindingRole && bindingRole !== "researcher") {
              throw new Error(
                "Only Researcher may bind a Discord/channel session to a project in this workflow."
              );
            }
            const requestedProjectRoot =
              readString(channelBinding?.projectRoot) ??
              readString(channelBinding?.project_path) ??
              process.env.OPENCLAW_PROJECT ??
              snapshot.projectRoot;
            if (!requestedProjectRoot) {
              throw new Error(
                "bind_channel_project requires channelBinding.projectRoot, or OPENCLAW_PROJECT must already point at the target project."
              );
            }
            const bound = await bindChannelProjectForWorkflow({
              policy: workflowPolicy,
              workspaceDir: ctx.workspaceDir,
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              messageChannel: ctx.messageChannel,
              channelKey: readString(channelBinding?.channelKey),
              projectRoot: requestedProjectRoot,
              projectId:
                readString(channelBinding?.projectId) ??
                readString(channelBinding?.project_id),
              boundByAgent: ctx.agentId,
              notes: readString(channelBinding?.notes),
            });
            return textResponse(JSON.stringify(bound, null, 2));
          }
          case "unbind_channel_project": {
            if (bindingRole && bindingRole !== "researcher") {
              throw new Error(
                "Only Researcher may remove a Discord/channel session project binding in this workflow."
              );
            }
            const result = await unbindChannelProjectForWorkflow({
              policy: workflowPolicy,
              workspaceDir: ctx.workspaceDir,
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              messageChannel: ctx.messageChannel,
              channelKey: readString(channelBinding?.channelKey),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "auto_iterator_tick": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const iterator = asObject(params.iterator);
            const result = await runWorkflowAutoIterator({
              projectRoot,
              agentId: ctx.agentId,
              mode: readString(iterator?.mode),
              queueMailbox:
                iterator?.queueMailbox === false ||
                iterator?.queue_mailbox === false
                  ? false
                  : true,
              cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
            });
            const dispatchResult =
              iterator?.dispatchTasks === false || iterator?.dispatch_tasks === false
                ? null
                : await maybeDispatchAutoIteratorTask({
                    api,
                    workflowPolicy,
                    agentCtx: ctx,
                    snapshot,
                    result,
                    waitTimeoutMs:
                      (readNumber(iterator?.waitTimeoutMs) ??
                        readNumber(iterator?.wait_timeout_ms)) ??
                      5000,
                    retryOnTimeout:
                      iterator?.retryOnTimeout === true ||
                      iterator?.retry_on_timeout === true,
                    enableSpawnFallback:
                      iterator?.enableSpawnFallback === false ||
                      iterator?.enable_spawn_fallback === false
                        ? false
                        : true,
                  });
            return textResponse(
              JSON.stringify(
                {
                  ...result,
                  agentTaskDispatch: dispatchResult,
                },
                null,
                2
              )
            );
          }
          case "dispatch_task": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            if (!snapshot.role) {
              throw new Error("Cannot determine the current workflow role for dispatch_task.");
            }
            const toAgent = inferTargetRoleFromToolParams({
              agentId: params.toAgent,
            }) as DispatchableWorkflowRole | null;
            if (!toAgent) {
              throw new Error("toAgent must be one of the known workflow agents.");
            }
            if (!canRoleContact(snapshot.role, toAgent)) {
              throw new Error(`${snapshot.role} cannot dispatch work to ${toAgent}.`);
            }
            const cooldown = await getWorkflowContactCooldown({
              projectRoot,
              fromAgent: snapshot.role,
              toAgent,
              cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
            });
            if (cooldown.blocked) {
              return textResponse(
                JSON.stringify(
                  {
                    dispatched: false,
                    blockedByCooldown: true,
                    cooldownRemainingSeconds: cooldown.remainingSeconds,
                    lastEvent: cooldown.lastEvent,
                  },
                  null,
                  2
                )
              );
            }
            const subject = readString(params.subject) ?? "Workflow task dispatch";
            const body = readString(params.body);
            const dispatch = await dispatchWorkflowTaskToAgent({
              runtimeSubagent: api.runtime?.subagent,
              requesterSessionKey: ctx.sessionKey,
              requesterChannel: ctx.messageChannel,
              fromRole: snapshot.role,
              toRole: toAgent,
              projectRoot,
              projectId: snapshot.projectId,
              stage: snapshot.currentStage,
              summary: subject,
              command: body ?? snapshot.nextAction,
              extraBody: body,
              waitTimeoutMs: Math.max(
                0,
                Math.floor(((readNumber(params.waitSeconds) ?? 0) as number) * 1000)
              ),
              retryOnTimeout: params.retryOnTimeout === true,
              enableSpawnFallback: params.enableSpawnFallback === false ? false : true,
            });
            if (dispatch.dispatched) {
              await recordWorkflowContactEvent({
                projectRoot,
                fromAgent: snapshot.role,
                toAgent,
                channel: dispatch.channel ?? "sessions_send",
              });
            }
            return textResponse(JSON.stringify(dispatch, null, 2));
          }
          case "get_idle_research": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const state = await getIdleResearchStateSummary({
              projectRoot,
            });
            return textResponse(JSON.stringify(state, null, 2));
          }
          case "set_idle_research": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await setIdleResearchState({
              projectRoot,
              idleResearch: requireObject(params.idleResearch, "idleResearch"),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "record_idle_research_run": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await recordIdleResearchRun({
              projectRoot,
              idleResearchRun: requireObject(
                params.idleResearchRun,
                "idleResearchRun"
              ),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "get_experiment_memory": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const summary = await getExperimentMemorySummary({
              projectRoot,
              limit:
                typeof params.limit === "number" && Number.isFinite(params.limit)
                  ? Math.floor(params.limit)
                  : 6,
            });
            return textResponse(JSON.stringify(summary, null, 2));
          }
          case "get_innovation_reflection": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const summary = await getInnovationReflectionStateSummary({
              projectRoot,
            });
            return textResponse(JSON.stringify(summary, null, 2));
          }
          case "get_writing_contract": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const summary = await getWritingContractStateSummary({
              projectRoot,
            });
            return textResponse(JSON.stringify(summary, null, 2));
          }
          case "get_citation_integrity": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const summary = await getCitationIntegrityStateSummary({
              projectRoot,
            });
            return textResponse(JSON.stringify(summary, null, 2));
          }
          case "upsert_experiment": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await upsertExperimentLedgerEntry({
              projectRoot,
              projectId: snapshot.projectId,
              agentId: ctx.agentId,
              experiment: requireObject(params.experiment, "experiment"),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "record_innovation_reflection": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await recordInnovationReflection({
              projectRoot,
              innovationReflection: requireObject(
                params.innovationReflection,
                "innovationReflection"
              ),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "set_writing_contract": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await setWritingContractState({
              projectRoot,
              writingContract: requireObject(
                params.writingContract,
                "writingContract"
              ),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "record_citation_verification": {
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const result = await recordCitationVerification({
              projectRoot,
              citationVerification: requireObject(
                params.citationVerification,
                "citationVerification"
              ),
            });
            return textResponse(JSON.stringify(result, null, 2));
          }
          case "read_mailbox": {
            if (!workflowPolicy.enableWorkflowMailbox) {
              throw new Error("Workflow mailbox is disabled by plugin policy.");
            }
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const messages = await readWorkflowMailboxForAgent({
              projectRoot,
              agentId: ctx.agentId,
              limit:
                typeof params.limit === "number" && Number.isFinite(params.limit)
                  ? Math.floor(params.limit)
                  : workflowPolicy.maxWorkflowInboxMessages,
              includeAcknowledged: params.includeAcknowledged === true,
            });
            return textResponse(JSON.stringify(messages, null, 2));
          }
          case "send_mailbox": {
            if (!workflowPolicy.enableWorkflowMailbox) {
              throw new Error("Workflow mailbox is disabled by plugin policy.");
            }
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            if (!snapshot.role) {
              throw new Error("Cannot determine the current agent role for mailbox delivery.");
            }
            const toAgent = inferTargetRoleFromToolParams({
              agentId: params.toAgent,
            });
            if (!toAgent) {
              throw new Error("toAgent must be one of the known workflow agents.");
            }
            if (!canRoleContact(snapshot.role, toAgent)) {
              throw new Error(
                `${snapshot.role} is not allowed to contact ${toAgent}; use the bounded workflow path instead.`
              );
            }
            const cooldown = await getWorkflowContactCooldown({
              projectRoot,
              fromAgent: snapshot.role,
              toAgent,
              cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
            });
            if (cooldown.blocked) {
              throw new Error(
                `${snapshot.role} already contacted ${toAgent} via ${cooldown.lastEvent?.channel ?? "workflow"} at ${cooldown.lastEvent?.createdAt ?? "recently"}. Wait about ${cooldown.remainingSeconds}s before contacting again.`
              );
            }
            const subject = readString(params.subject);
            const body = readString(params.body);
            if (!subject || !body) {
              throw new Error("subject and body are required for send_mailbox.");
            }
            const item = await queueWorkflowMailboxMessage({
              projectRoot,
              fromAgent: snapshot.role,
              toAgent,
              subject,
              body,
              kind: readString(params.kind),
              priority: readString(params.priority),
            });
            await recordWorkflowContactEvent({
              projectRoot,
              fromAgent: snapshot.role,
              toAgent,
              channel: "mailbox",
            });
            return textResponse(JSON.stringify(item, null, 2));
          }
          case "ack_mailbox": {
            if (!workflowPolicy.enableWorkflowMailbox) {
              throw new Error("Workflow mailbox is disabled by plugin policy.");
            }
            if (!projectRoot) {
              throw new Error(projectRequiredMessage);
            }
            const messageId = readString(params.messageId);
            if (!messageId) {
              throw new Error("messageId is required for ack_mailbox.");
            }
            const acknowledged = await acknowledgeWorkflowMailboxMessage({
              projectRoot,
              messageId,
              agentId: ctx.agentId,
            });
            if (!acknowledged) {
              throw new Error(`No workflow mailbox message found for id: ${messageId}`);
            }
            return textResponse(JSON.stringify(acknowledged, null, 2));
          }
          default:
            throw new Error(`Unsupported research_workflow action: ${action}`);
        }
      },
    }),
    { optional: true }
  );

  api.on?.(
    "before_prompt_build",
    async (_event, hookCtx) => {
      const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
      const agentCtx = getToolContext(hookCtx);
      const trigger = readString(hookCtx.trigger);
      if (!workflowPolicy.injectWorkflowContext) {
        return;
      }
      if (trigger === "heartbeat" && !workflowPolicy.heartbeatBackgroundChecks) {
        return;
      }
      const snapshot = await buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: agentCtx.agentId,
        workspaceDir: agentCtx.workspaceDir,
        sessionKey: agentCtx.sessionKey,
        sessionId: agentCtx.sessionId,
        messageChannel: agentCtx.messageChannel,
      });
      await maybeAutoBindChannelProject({
        policy: workflowPolicy,
        agentCtx,
        snapshot,
      });
      return {
        prependContext: formatWorkflowSnapshotForPrompt({
          snapshot,
          trigger,
        }),
      };
    },
    { priority: 40 }
  );

  api.on?.(
    "before_tool_call",
    async (event, hookCtx) => {
      const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
      const agentCtx = getToolContext(hookCtx);
      const toolName = String(event.toolName ?? "");
      const params = requireObject<Record<string, unknown>>(event.params, "tool params");

      const snapshot = await buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: agentCtx.agentId,
        workspaceDir: agentCtx.workspaceDir,
        sessionKey: agentCtx.sessionKey,
        sessionId: agentCtx.sessionId,
        messageChannel: agentCtx.messageChannel,
      });
      await maybeAutoBindChannelProject({
        policy: workflowPolicy,
        agentCtx,
        snapshot,
      });

      if (workflowPolicy.enforceWorkflowBoundaries) {
        const writeCheck = shouldBlockProjectWrite({
          role: snapshot.role,
          projectRoot: snapshot.projectRoot,
          toolName,
          toolParams: params,
        });
        if (writeCheck.block) {
          return {
            block: true,
            blockReason: writeCheck.reason,
          };
        }

        const coderDatasetCheck = shouldBlockCoderDatasetMutation({
          role: snapshot.role,
          projectRoot: snapshot.projectRoot,
          toolName,
          toolParams: params,
        });
        if (coderDatasetCheck.block) {
          return {
            block: true,
            blockReason: coderDatasetCheck.reason,
          };
        }

        const innovationWriteCheck = shouldBlockInnovationWrite({
          role: snapshot.role,
          projectRoot: snapshot.projectRoot,
          currentStage: snapshot.currentStage,
          innovationReflectionDue: snapshot.innovationReflectionDue,
          toolName,
          toolParams: params,
        });
        if (innovationWriteCheck.block) {
          return {
            block: true,
            blockReason: innovationWriteCheck.reason,
          };
        }

        const writerTemplateCheck = shouldBlockWriterTemplateWrite({
          role: snapshot.role,
          projectRoot: snapshot.projectRoot,
          currentStage: snapshot.currentStage,
          writingTemplateRequired: snapshot.writingTemplateRequired,
          writingTemplateStatus: snapshot.writingTemplateStatus,
          toolName,
          toolParams: params,
        });
        if (writerTemplateCheck.block) {
          return {
            block: true,
            blockReason: writerTemplateCheck.reason,
          };
        }

        if (toolName === "sessions_spawn") {
          const targetRole = inferTargetRoleFromToolParams(params);
          if (!snapshot.role) {
            return {
              block: true,
              blockReason:
                "Cannot determine requester role for sessions_spawn. Retry after workflow context is restored.",
            };
          }
          if (!targetRole || !canRoleSpawn(snapshot.role, targetRole)) {
            return {
              block: true,
              blockReason: `${snapshot.role} cannot spawn ${targetRole ?? "that target"} in this workflow.`,
            };
          }
          if (snapshot.projectRoot) {
            const cooldown = await getWorkflowContactCooldown({
              projectRoot: snapshot.projectRoot,
              fromAgent: snapshot.role,
              toAgent: targetRole,
              cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
            });
            if (cooldown.blocked) {
              return {
                block: true,
                blockReason: `${snapshot.role} already contacted/spawned ${targetRole} via ${cooldown.lastEvent?.channel ?? "workflow"} at ${cooldown.lastEvent?.createdAt ?? "recently"}. Wait about ${cooldown.remainingSeconds}s before retrying.`,
              };
            }
          }
          if (
            targetRole === "coder" &&
            snapshot.missingStageSignals.some(
              (signal) =>
                signal.includes("{PROJ}/orchestrator/PLAN.md") ||
                signal.includes("{PROJ}/orchestrator/TODOS.md") ||
                signal.includes("{PROJ}/orchestrator/PLAN_AUDIT.md")
            )
          ) {
            return {
              block: true,
              blockReason:
                "Do not spawn Coder before PLAN.md, TODOS.md, and PLAN_AUDIT.md exist. Wake Orchestrator first.",
            };
          }
        }

        if (toolName === "sessions_send") {
          const targetRole = inferTargetRoleFromToolParams(params);
          if (!snapshot.role) {
            return {
              block: true,
              blockReason:
                "Cannot determine requester role for sessions_send. Use research_workflow.send_mailbox after workflow context is restored.",
            };
          }
          if (!targetRole || !canRoleContact(snapshot.role, targetRole)) {
            return {
              block: true,
              blockReason: `${snapshot.role} should not send ad hoc internal messages to ${targetRole ?? "that target"}. Use research_workflow.send_mailbox or the approved workflow path.`,
            };
          }
          if (snapshot.projectRoot) {
            const cooldown = await getWorkflowContactCooldown({
              projectRoot: snapshot.projectRoot,
              fromAgent: snapshot.role,
              toAgent: targetRole,
              cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
            });
            if (cooldown.blocked) {
              return {
                block: true,
                blockReason: `${snapshot.role} already contacted ${targetRole} via ${cooldown.lastEvent?.channel ?? "workflow"} at ${cooldown.lastEvent?.createdAt ?? "recently"}. Wait about ${cooldown.remainingSeconds}s before sending again.`,
              };
            }
            await recordWorkflowContactEvent({
              projectRoot: snapshot.projectRoot,
              fromAgent: snapshot.role,
              toAgent: targetRole,
              channel: "sessions_send",
            });
          }
        }
      }

      if (workflowPolicy.blockDiscordAgentMentions && toolName === "message") {
        const sanitized = sanitizeMessageToolParams(params);
        if (sanitized) {
          return {
            params: sanitized,
          };
        }
      }

      return;
    },
    { priority: 50 }
  );

  api.on?.(
    "message_sending",
    async (event, hookCtx) => {
      const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
      const channelId = readString(hookCtx.channelId)?.toLowerCase();
      const content = readString(event.content);
      if (!workflowPolicy.blockDiscordAgentMentions || channelId !== "discord" || !content) {
        return;
      }
      const sanitized = sanitizeAgentMentions(content);
      if (sanitized === content) {
        return;
      }
      return {
        content: sanitized,
      };
    },
    { priority: 40 }
  );

  api.on?.(
    "subagent_spawning",
    async (event, hookCtx) => {
      const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
      if (!workflowPolicy.enforceWorkflowBoundaries) {
        return;
      }
      const requesterRole = inferTargetRoleFromToolParams({
        sessionKey: hookCtx.requesterSessionKey,
      });
      const childRole = inferTargetRoleFromToolParams({
        agentId: event.agentId,
      });
      if (!requesterRole || !childRole) {
        return;
      }
      if (!canRoleSpawn(requesterRole, childRole)) {
        return {
          status: "error",
          error: `${requesterRole} cannot spawn ${childRole} in this workflow.`,
        };
      }
      if (childRole === "coder") {
        const snapshot = await buildWorkflowSnapshot({
          policy: workflowPolicy,
          agentId: requesterRole,
          workspaceDir: readString(hookCtx.workspaceDir),
          sessionKey: readString(hookCtx.requesterSessionKey),
          sessionId: readString(hookCtx.requesterSessionId),
          messageChannel: readString(hookCtx.messageChannel),
        });
        await maybeAutoBindChannelProject({
          policy: workflowPolicy,
          agentCtx: {
            agentId: requesterRole,
            workspaceDir: readString(hookCtx.workspaceDir),
            sessionKey: readString(hookCtx.requesterSessionKey),
            sessionId: readString(hookCtx.requesterSessionId),
            messageChannel: readString(hookCtx.messageChannel),
          },
          snapshot,
        });
        const missingPlanSignals = snapshot.missingStageSignals.filter(
          (signal) =>
            signal.includes("{PROJ}/orchestrator/PLAN.md") ||
            signal.includes("{PROJ}/orchestrator/TODOS.md") ||
            signal.includes("{PROJ}/orchestrator/PLAN_AUDIT.md")
        );
        if (missingPlanSignals.length > 0) {
          return {
            status: "error",
            error:
              "Coder spawn denied because PLAN.md, TODOS.md, or PLAN_AUDIT.md is missing. Complete PLAN first.",
          };
        }
        if (snapshot.projectRoot) {
          await recordWorkflowContactEvent({
            projectRoot: snapshot.projectRoot,
            fromAgent: requesterRole,
            toAgent: childRole,
            channel: "sessions_spawn",
          });
        }
        return;
      }
      const snapshot = await buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: requesterRole,
        workspaceDir: readString(hookCtx.workspaceDir),
        sessionKey: readString(hookCtx.requesterSessionKey),
        sessionId: readString(hookCtx.requesterSessionId),
        messageChannel: readString(hookCtx.messageChannel),
      });
      await maybeAutoBindChannelProject({
        policy: workflowPolicy,
        agentCtx: {
          agentId: requesterRole,
          workspaceDir: readString(hookCtx.workspaceDir),
          sessionKey: readString(hookCtx.requesterSessionKey),
          sessionId: readString(hookCtx.requesterSessionId),
          messageChannel: readString(hookCtx.messageChannel),
        },
        snapshot,
      });
      if (snapshot.projectRoot) {
        await recordWorkflowContactEvent({
          projectRoot: snapshot.projectRoot,
          fromAgent: requesterRole,
          toAgent: childRole,
          channel: "sessions_spawn",
        });
      }
      return;
    },
    { priority: 45 }
  );
}
