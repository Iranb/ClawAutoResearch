import {
  assembleWritePackage,
  acknowledgeWorkflowMailboxMessage,
  bindChannelProjectForWorkflow,
  buildWorkflowSnapshot,
  canRoleContact,
  getBrainstormCycleStateSummary,
  checkGraphPresenceForWorkflow,
  getCitationCollectionStateSummary,
  getChannelProjectBindingForWorkflow,
  getCitationIntegrityStateSummary,
  getExperimentSearchStateSummary,
  getExternalReviewStateSummary,
  getExperimentMemorySummary,
  getFigureQcStateSummary,
  getGraphGuidedWritingStateSummary,
  getIdleResearchStateSummary,
  getInnovationReflectionStateSummary,
  getOrchestrationStateSummary,
  getPaperQcStateSummary,
  getResearchProgramStateSummary,
  getProjectRootForWorkflow,
  getReviewIssueTrackerStateSummary,
  getReviewSessionStateSummary,
  getTheoryStateSummary,
  getWorkflowContactCooldown,
  getWritePackageStateSummary,
  getWritingContractStateSummary,
  getWritingSessionStateSummary,
  inferTargetRoleFromToolParams,
  listChannelProjectBindingsForWorkflow,
  materializeTheoryAppendix,
  queueWorkflowMailboxMessage,
  readWorkflowMailboxForAgent,
  recordCitationVerification,
  recordIdleResearchRun,
  recordInnovationReflection,
  recordTheoryState,
  recordWorkflowContactEvent,
  runBrainstormCycle,
  runWorkflowAutoIterator,
  setBrainstormCycleState,
  setCitationCollectionState,
  setExperimentSearchState,
  setExternalReviewState,
  setFigureQcState,
  setGraphGuidedWritingState,
  setIdleResearchState,
  setOrchestrationState,
  setPaperQcState,
  setResearchProgramState,
  setReviewIssueTrackerState,
  setReviewSessionState,
  setWritePackageState,
  setWritingSessionState,
  setWritingContractState,
  unbindChannelProjectForWorkflow,
  upsertExperimentLedgerEntry,
  upsertTheoryProofPacket,
} from "./workflow-guard";
import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import { maybeBroadcastAutoIteratorStageChange } from "./stage-broadcast";
import { handoffWorkflowTaskToAgent } from "./lobster-handoff";
import {
  startBackgroundWorkflowRun,
  type BackgroundRunRequest,
} from "./workflow-fast-paths";
import {
  asObject,
  maybeAutoBindChannelProject,
  readNumber,
  readString,
  requireObject,
  textResponse,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";
import {
  buildWorkflowQueueContext,
  enqueueWorkflowTask,
} from "./workflow-coordination";
import { getGateReviewStorePath, readGateReviewStore } from "./workflow-auto-gate";
import { appendWorkflowTraceEvent } from "./workflow-trace";
import { inspectPapernexusRemoteAccess } from "./papernexus-secret";

type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;

type WorkflowToolState = {
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  channelBinding: Record<string, unknown> | null;
  snapshot: WorkflowSnapshot;
  projectRoot: string | null;
  projectRequiredMessage: string;
  bindingRole: string | null;
};

type AutoIteratorResult = Awaited<ReturnType<typeof runWorkflowAutoIterator>>;

const SERIALIZED_WORKFLOW_ACTIONS = new Set([
  "auto_iterator_tick",
  "start_background_run",
  "bind_channel_project",
  "unbind_channel_project",
  "dispatch_task",
  "read_mailbox",
  "send_mailbox",
  "ack_mailbox",
]);

const WORKFLOW_ACTION_FUNCTIONS: Record<string, string> = {
  get_snapshot: "buildWorkflowSnapshot",
  get_papernexus_remote_access: "inspectPapernexusRemoteAccess",
  check_graph_presence: "checkGraphPresenceForWorkflow",
  auto_iterator_tick: "runWorkflowAutoIterator",
  start_background_run: "startBackgroundWorkflowRun",
  get_idle_research: "getIdleResearchStateSummary",
  set_idle_research: "setIdleResearchState",
  record_idle_research_run: "recordIdleResearchRun",
  get_experiment_memory: "getExperimentMemorySummary",
  get_innovation_reflection: "getInnovationReflectionStateSummary",
  get_brainstorm_cycle: "getBrainstormCycleStateSummary",
  set_brainstorm_cycle: "setBrainstormCycleState",
  run_brainstorm_cycle: "runBrainstormCycle",
  get_research_program: "getResearchProgramStateSummary",
  set_research_program: "setResearchProgramState",
  get_orchestration_state: "getOrchestrationStateSummary",
  set_orchestration_state: "setOrchestrationState",
  get_theory_state: "getTheoryStateSummary",
  get_writing_contract: "getWritingContractStateSummary",
  get_write_package: "getWritePackageStateSummary",
  set_write_package: "setWritePackageState",
  assemble_write_package: "assembleWritePackage",
  get_writing_session: "getWritingSessionStateSummary",
  set_writing_session: "setWritingSessionState",
  get_review_session: "getReviewSessionStateSummary",
  set_review_session: "setReviewSessionState",
  get_graph_guided_writing: "getGraphGuidedWritingStateSummary",
  set_graph_guided_writing: "setGraphGuidedWritingState",
  get_citation_integrity: "getCitationIntegrityStateSummary",
  get_paper_qc: "getPaperQcStateSummary",
  set_paper_qc: "setPaperQcState",
  get_figure_qc: "getFigureQcStateSummary",
  set_figure_qc: "setFigureQcState",
  get_citation_collection: "getCitationCollectionStateSummary",
  set_citation_collection: "setCitationCollectionState",
  get_review_issue_tracker: "getReviewIssueTrackerStateSummary",
  set_review_issue_tracker: "setReviewIssueTrackerState",
  get_experiment_search: "getExperimentSearchStateSummary",
  set_experiment_search: "setExperimentSearchState",
  get_external_review_state: "getExternalReviewStateSummary",
  set_external_review_state: "setExternalReviewState",
  get_gate_review_state: "readGateReviewStore",
  upsert_experiment: "upsertExperimentLedgerEntry",
  record_theory_state: "recordTheoryState",
  upsert_proof_packet: "upsertTheoryProofPacket",
  materialize_theory_appendix: "materializeTheoryAppendix",
  record_innovation_reflection: "recordInnovationReflection",
  set_writing_contract: "setWritingContractState",
  record_citation_verification: "recordCitationVerification",
  get_channel_project_binding: "getChannelProjectBindingForWorkflow",
  bind_channel_project: "bindChannelProjectForWorkflow",
  unbind_channel_project: "unbindChannelProjectForWorkflow",
  list_channel_project_bindings: "listChannelProjectBindingsForWorkflow",
  dispatch_task: "dispatchWorkflowTaskToAgent",
  read_mailbox: "readWorkflowMailboxForAgent",
  send_mailbox: "queueWorkflowMailboxMessage",
  ack_mailbox: "acknowledgeWorkflowMailboxMessage",
};

async function resolveWorkflowToolState(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  rawParams: Record<string, unknown>;
  autoBind?: boolean;
}): Promise<WorkflowToolState> {
  const workflowPolicy = params.plugin.getWorkflowPolicy();
  const channelBinding = asObject(params.rawParams.channelBinding);
  const snapshot = await buildWorkflowSnapshot({
    policy: workflowPolicy,
    agentId: params.agentCtx.agentId,
    workspaceDir: params.agentCtx.workspaceDir,
    sessionKey: params.agentCtx.sessionKey,
    sessionId: params.agentCtx.sessionId,
    messageChannel: params.agentCtx.messageChannel,
    channelKey: readString(channelBinding?.channelKey),
  });
  if (params.autoBind !== false) {
    await maybeAutoBindChannelProject({
      policy: workflowPolicy,
      agentCtx: params.agentCtx,
      snapshot,
    });
  }

  const projectRoot =
    snapshot.projectRoot ??
    getProjectRootForWorkflow({
      policy: workflowPolicy,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      channelKey: readString(channelBinding?.channelKey),
    });

  return {
    workflowPolicy,
    channelBinding,
    snapshot,
    projectRoot,
    projectRequiredMessage:
      "A resolved project is required for this workflow action. Bind the current Discord/channel session to a project or set OPENCLAW_PROJECT.",
    bindingRole:
      snapshot.role ?? (params.agentCtx.agentId ? params.agentCtx.agentId.toLowerCase() : null),
  };
}

function shouldQueueWorkflowAction(action: string): boolean {
  return SERIALIZED_WORKFLOW_ACTIONS.has(action);
}

function resolveWorkflowToolQueueContext(
  state: WorkflowToolState,
  agentCtx: ToolContext
) {
  return buildWorkflowQueueContext({
    projectRoot:
      state.projectRoot ??
      readString(state.channelBinding?.projectRoot) ??
      readString(state.channelBinding?.project_path) ??
      state.snapshot.projectRoot,
    workspaceDir: agentCtx.workspaceDir,
    sessionKey: agentCtx.sessionKey,
    sessionId: agentCtx.sessionId,
    messageChannel: agentCtx.messageChannel,
    channelKey:
      readString(state.channelBinding?.channelKey) ??
      state.snapshot.channelProjectBindingKey,
  });
}

function requireWorkflowProjectRoot(state: WorkflowToolState): string {
  if (!state.projectRoot) {
    throw new Error(state.projectRequiredMessage);
  }
  return state.projectRoot;
}

function buildUnboundProjectAutoIteratorPayload(params: {
  snapshot: WorkflowSnapshot;
  iterator: Record<string, unknown> | null;
}) {
  return {
    projectRoot: null,
    projectId: null,
    mode: readString(params.iterator?.mode) ?? "default",
    configuredAutoMode: "off",
    effectiveAutoMode: "off",
    autoModeRiskLevel: "stable",
    autoModeReasons: [],
    autoModeRiskFingerprint: null,
    autoModeMitigationStatus: null,
    autoModeMitigationRoundsStarted: 0,
    autoModeMitigationRoundsRemaining: 0,
    stageBefore: null,
    stageEffective: null,
    stageAfter: null,
    stageChanged: false,
    regressed: false,
    gateBlocking: false,
    gateReason: null,
    missingStageSignals: ["No active project is bound to this channel/session."],
    ownerBefore: params.snapshot.ownerAgent ?? null,
    ownerAfter: params.snapshot.role === "researcher" ? "researcher" : null,
    nextAction:
      'Start a project with /research-pipeline or call research_workflow.bind_channel_project with a projectId/topic so the plugin can scaffold it under projectsRoot.',
    resumeAction:
      "After a project exists, run /resume-pipeline or research_workflow.auto_iterator_tick again.",
    blockingReason:
      "No active project is bound to this channel/session.",
    graphPresenceCheck: null,
    projectsStateUpdated: false,
    auditPath: null,
    recommendedActions: [
      {
        kind: "background",
        stage: "setup",
        owner: "researcher",
        summary:
          "No active project is bound to this Discord/session context yet.",
        command:
          '/research-pipeline "topic" or research_workflow.bind_channel_project with projectId/topic',
        mailboxQueued: false,
        mailboxMessageId: null,
        cooldownRemainingSeconds: null,
        blocking: false,
      },
    ],
    agentTaskDispatch: null,
  };
}

async function maybeDispatchAutoIteratorTask(params: {
  plugin: PluginRegistrationContext;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  agentCtx: ToolContext;
  snapshot: WorkflowSnapshot;
  result: AutoIteratorResult;
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
  const dispatch = await handoffWorkflowTaskToAgent({
    runtimeSubagent: params.plugin.api.runtime?.subagent,
    workflowPolicy: params.workflowPolicy,
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
    autoModeActive:
      (params.result.effectiveAutoMode ?? params.workflowPolicy.autoMode ?? "off") !== "off",
    logger: params.plugin.api.logger,
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

export function registerWorkflowTools(plugin: PluginRegistrationContext) {
  plugin.api.registerTool(
    (ctx) => ({
      name: "research_workflow",
      description:
        "Project workflow guard, deterministic auto-iterator, idle research state, experiment ledger, theory/proof packets, innovation reflection, writing contract, citation integrity state, and mailbox. Use it to inspect current workflow state, reconcile and advance stages deterministically, keep structured background/experiment/theory memory current, refresh experiment-informed ideation memory, persist template-driven writing constraints, record citation verification, read or send bounded handoff messages, and avoid direct edits to workflow state files.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: [
              "get_snapshot",
              "get_papernexus_remote_access",
              "check_graph_presence",
              "auto_iterator_tick",
              "start_background_run",
              "get_idle_research",
              "set_idle_research",
              "record_idle_research_run",
              "get_experiment_memory",
              "get_innovation_reflection",
              "get_brainstorm_cycle",
              "set_brainstorm_cycle",
              "run_brainstorm_cycle",
              "get_research_program",
              "set_research_program",
              "get_orchestration_state",
              "set_orchestration_state",
              "get_theory_state",
              "get_writing_contract",
              "get_write_package",
              "set_write_package",
              "assemble_write_package",
              "get_writing_session",
              "set_writing_session",
              "get_review_session",
              "set_review_session",
              "get_graph_guided_writing",
              "set_graph_guided_writing",
              "get_citation_integrity",
              "get_paper_qc",
              "set_paper_qc",
              "get_figure_qc",
              "set_figure_qc",
              "get_citation_collection",
              "set_citation_collection",
              "get_review_issue_tracker",
              "set_review_issue_tracker",
              "get_experiment_search",
              "set_experiment_search",
              "get_external_review_state",
              "set_external_review_state",
              "get_gate_review_state",
              "upsert_experiment",
              "record_theory_state",
              "upsert_proof_packet",
              "materialize_theory_appendix",
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
          backgroundRun: {
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
          brainstormCycle: {
            type: "object",
            additionalProperties: true,
          },
          researchProgram: {
            type: "object",
            additionalProperties: true,
          },
          orchestrationState: {
            type: "object",
            additionalProperties: true,
          },
          theoryState: {
            type: "object",
            additionalProperties: true,
          },
          proofPacket: {
            type: "object",
            additionalProperties: true,
          },
          theoryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          writingContract: {
            type: "object",
            additionalProperties: true,
          },
          writePackage: {
            type: "object",
            additionalProperties: true,
          },
          writePackageAssembly: {
            type: "object",
            additionalProperties: true,
          },
          writingSession: {
            type: "object",
            additionalProperties: true,
          },
          reviewSession: {
            type: "object",
            additionalProperties: true,
          },
          externalReview: {
            type: "object",
            additionalProperties: true,
          },
          paperQc: {
            type: "object",
            additionalProperties: true,
          },
          figureQc: {
            type: "object",
            additionalProperties: true,
          },
          citationCollection: {
            type: "object",
            additionalProperties: true,
          },
          reviewIssueTracker: {
            type: "object",
            additionalProperties: true,
          },
          experimentSearch: {
            type: "object",
            additionalProperties: true,
          },
          graphGuidedWriting: {
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
          command: {
            type: "string",
          },
          body: {
            type: "string",
          },
          extraBody: {
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
        const action = String(params.action ?? "");
        const executeAction = async () => {
          const state = await resolveWorkflowToolState({
            plugin,
            agentCtx: ctx,
            rawParams: params,
          });
          const {
            workflowPolicy,
            channelBinding,
            snapshot,
            projectRoot,
            projectRequiredMessage,
            bindingRole,
          } = state;
          const traceAction = async (
            status: "started" | "failed",
            details?: Record<string, unknown>
          ) => {
            if (!projectRoot) {
              return;
            }
            await appendWorkflowTraceEvent({
              projectRoot,
              projectId: snapshot.projectId,
              kind: "tool_action",
              action,
              functionName: WORKFLOW_ACTION_FUNCTIONS[action] ?? action,
              stage: snapshot.currentStage,
              owner: snapshot.ownerAgent,
              agentId: ctx.agentId,
              sessionKey: ctx.sessionKey,
              summary: `research_workflow.${action} ${status}`,
              details: {
                status,
                ...(details ?? {}),
              },
            });
          };
          await traceAction("started");

          try {
            switch (action) {
              case "get_snapshot":
                return textResponse(JSON.stringify(snapshot, null, 2));
            case "get_papernexus_remote_access": {
              const access = await inspectPapernexusRemoteAccess({
                apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
                tokenSource: workflowPolicy.papernexusApiTokenSource,
                tokenEnv: workflowPolicy.papernexusApiTokenEnv,
                tokenService: workflowPolicy.papernexusApiTokenService,
                tokenAccount: workflowPolicy.papernexusApiTokenAccount,
                mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
                tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
              });
              return textResponse(
                JSON.stringify(
                  {
                    ...access,
                    token: access.tokenAvailable ? "[REDACTED]" : null,
                  },
                  null,
                  2
                )
              );
            }
            case "check_graph_presence": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const graphPresenceCheck = asObject(params.graphPresenceCheck);
              const result = await checkGraphPresenceForWorkflow({
                projectRoot: resolvedProjectRoot,
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
              const bound = await bindChannelProjectForWorkflow({
                policy: workflowPolicy,
                workspaceDir: ctx.workspaceDir,
                sessionKey: ctx.sessionKey,
                sessionId: ctx.sessionId,
                messageChannel: ctx.messageChannel,
                channelKey: readString(channelBinding?.channelKey),
                projectRoot:
                  readString(channelBinding?.projectRoot) ??
                  readString(channelBinding?.project_path) ??
                  process.env.OPENCLAW_PROJECT ??
                  snapshot.projectRoot,
                projectId:
                  readString(channelBinding?.projectId) ??
                  readString(channelBinding?.project_id) ??
                  snapshot.projectId,
                title:
                  readString(channelBinding?.title) ??
                  readString(channelBinding?.topic),
                topic: readString(channelBinding?.topic),
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
              const iterator = asObject(params.iterator);
              if (!projectRoot) {
                return textResponse(
                  JSON.stringify(
                    buildUnboundProjectAutoIteratorPayload({
                      snapshot,
                      iterator,
                    }),
                    null,
                    2
                  )
                );
              }
              const result = await runWorkflowAutoIterator({
                projectRoot,
                policy: workflowPolicy,
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
                      plugin,
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
              const stageBroadcast =
                iterator?.broadcastStageChange === false ||
                iterator?.broadcast_stage_change === false
                  ? {
                      broadcasted: false,
                      reasonSkipped: "disabled_by_iterator",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    }
                  : await maybeBroadcastAutoIteratorStageChange({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      sessionKey: ctx.sessionKey,
                      projectId: snapshot.projectId,
                      projectRoot,
                      stageBefore: result.stageBefore,
                      stageAfter: result.stageAfter,
                      stageChanged: result.stageChanged,
                      ownerBefore: result.ownerBefore,
                      ownerAfter: result.ownerAfter,
                      nextAction: result.nextAction,
                      blockingReason: result.blockingReason,
                      regressed: result.regressed,
                      recommendedActions: result.recommendedActions,
                      agentTaskDispatch: dispatchResult,
                    });
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    agentTaskDispatch: dispatchResult,
                    stageBroadcast,
                  },
                  null,
                  2
                )
              );
            }
            case "start_background_run": {
              const backgroundRun = requireObject<BackgroundRunRequest>(
                params.backgroundRun,
                "backgroundRun"
              );
              const result = await startBackgroundWorkflowRun({
                runtimeSubagent: plugin.api.runtime?.subagent,
                workflowPolicy,
                agentCtx: ctx,
                snapshot,
                backgroundRun,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "dispatch_task": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
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
                projectRoot: resolvedProjectRoot,
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
              const explicitCommand = readString(params.command);
              const explicitExtraBody = readString(params.extraBody);
              const command =
                explicitCommand ??
                (body && !body.includes("\n") ? body : snapshot.nextAction);
              const extraBody =
                explicitExtraBody ??
                (body && body.includes("\n") ? body : null);
              const dispatch = await dispatchWorkflowTaskToAgent({
                runtimeSubagent: plugin.api.runtime?.subagent,
                requesterSessionKey: ctx.sessionKey,
                requesterChannel: ctx.messageChannel,
                fromRole: snapshot.role,
                toRole: toAgent,
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                stage: snapshot.currentStage,
                summary: subject,
                command,
                extraBody,
                waitTimeoutMs: Math.max(
                  0,
                  Math.floor(((readNumber(params.waitSeconds) ?? 0) as number) * 1000)
                ),
                retryOnTimeout: params.retryOnTimeout === true,
                enableSpawnFallback: params.enableSpawnFallback === false ? false : true,
              });
              if (dispatch.dispatched) {
                await recordWorkflowContactEvent({
                  projectRoot: resolvedProjectRoot,
                  fromAgent: snapshot.role,
                  toAgent,
                  channel: dispatch.channel ?? "sessions_send",
                });
              }
              return textResponse(JSON.stringify(dispatch, null, 2));
            }
            case "get_idle_research": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getIdleResearchStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_idle_research": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setIdleResearchState({
                projectRoot: resolvedProjectRoot,
                idleResearch: requireObject(params.idleResearch, "idleResearch"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_idle_research_run": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordIdleResearchRun({
                projectRoot: resolvedProjectRoot,
                idleResearchRun: requireObject(
                  params.idleResearchRun,
                  "idleResearchRun"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_experiment_memory": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentMemorySummary({
                projectRoot: resolvedProjectRoot,
                limit:
                  typeof params.limit === "number" && Number.isFinite(params.limit)
                    ? Math.floor(params.limit)
                    : 6,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_innovation_reflection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getInnovationReflectionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getBrainstormCycleStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setBrainstormCycleState({
                projectRoot: resolvedProjectRoot,
                brainstormCycle: requireObject(
                  params.brainstormCycle,
                  "brainstormCycle"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "run_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await runBrainstormCycle({
                projectRoot: resolvedProjectRoot,
                brainstormCycle: requireObject(
                  params.brainstormCycle,
                  "brainstormCycle"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_research_program": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getResearchProgramStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_research_program": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setResearchProgramState({
                projectRoot: resolvedProjectRoot,
                researchProgram: requireObject(
                  params.researchProgram,
                  "researchProgram"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_orchestration_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getOrchestrationStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_orchestration_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setOrchestrationState({
                projectRoot: resolvedProjectRoot,
                orchestrationState: requireObject(
                  params.orchestrationState,
                  "orchestrationState"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_theory_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getTheoryStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_writing_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritingContractStateSummary({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritePackageStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritePackageState({
                projectRoot: resolvedProjectRoot,
                writePackage: requireObject(params.writePackage, "writePackage"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "assemble_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await assembleWritePackage({
                projectRoot: resolvedProjectRoot,
                mode: readString(asObject(params.writePackageAssembly)?.mode) ?? "deterministic",
                trigger:
                  readString(asObject(params.writePackageAssembly)?.trigger) ??
                  "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_writing_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritingSessionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_writing_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritingSessionState({
                projectRoot: resolvedProjectRoot,
                writingSession: requireObject(params.writingSession, "writingSession"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_review_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getReviewSessionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_review_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setReviewSessionState({
                projectRoot: resolvedProjectRoot,
                reviewSession: requireObject(params.reviewSession, "reviewSession"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_graph_guided_writing": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getGraphGuidedWritingStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_graph_guided_writing": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setGraphGuidedWritingState({
                projectRoot: resolvedProjectRoot,
                graphGuidedWriting: requireObject(
                  params.graphGuidedWriting,
                  "graphGuidedWriting"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_citation_integrity": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getCitationIntegrityStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_paper_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getPaperQcStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_paper_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setPaperQcState({
                projectRoot: resolvedProjectRoot,
                paperQc: requireObject(params.paperQc, "paperQc"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_figure_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getFigureQcStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_figure_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setFigureQcState({
                projectRoot: resolvedProjectRoot,
                figureQc: requireObject(params.figureQc, "figureQc"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_citation_collection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getCitationCollectionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_citation_collection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setCitationCollectionState({
                projectRoot: resolvedProjectRoot,
                citationCollection: requireObject(
                  params.citationCollection,
                  "citationCollection"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_review_issue_tracker": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getReviewIssueTrackerStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_review_issue_tracker": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setReviewIssueTrackerState({
                projectRoot: resolvedProjectRoot,
                reviewIssueTracker: requireObject(
                  params.reviewIssueTracker,
                  "reviewIssueTracker"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_experiment_search": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentSearchStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_experiment_search": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExperimentSearchState({
                projectRoot: resolvedProjectRoot,
                experimentSearch: requireObject(
                  params.experimentSearch,
                  "experimentSearch"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_external_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExternalReviewStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_external_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExternalReviewState({
                projectRoot: resolvedProjectRoot,
                externalReview: requireObject(
                  params.externalReview,
                  "externalReview"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_gate_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await readGateReviewStore(resolvedProjectRoot);
              return textResponse(
                JSON.stringify(
                  {
                    storePath: getGateReviewStorePath(resolvedProjectRoot),
                    ...summary,
                  },
                  null,
                  2
                )
              );
            }
            case "upsert_experiment": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await upsertExperimentLedgerEntry({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                agentId: ctx.agentId,
                experiment: requireObject(params.experiment, "experiment"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_theory_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordTheoryState({
                projectRoot: resolvedProjectRoot,
                theoryState: requireObject(params.theoryState, "theoryState"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "upsert_proof_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await upsertTheoryProofPacket({
                projectRoot: resolvedProjectRoot,
                proofPacket: requireObject(params.proofPacket, "proofPacket"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_theory_appendix": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeTheoryAppendix({
                projectRoot: resolvedProjectRoot,
                theoryMaterialization: asObject(params.theoryMaterialization),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_innovation_reflection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordInnovationReflection({
                projectRoot: resolvedProjectRoot,
                innovationReflection: requireObject(
                  params.innovationReflection,
                  "innovationReflection"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_writing_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritingContractState({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
                writingContract: requireObject(
                  params.writingContract,
                  "writingContract"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_citation_verification": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordCitationVerification({
                projectRoot: resolvedProjectRoot,
                citationVerification: requireObject(
                  params.citationVerification,
                  "citationVerification"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "read_mailbox": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
              }
              const messages = await readWorkflowMailboxForAgent({
                projectRoot: resolvedProjectRoot,
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
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
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
                projectRoot: resolvedProjectRoot,
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
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                subject,
                body,
                kind: readString(params.kind),
                priority: readString(params.priority),
              });
              await recordWorkflowContactEvent({
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                channel: "mailbox",
              });
              return textResponse(JSON.stringify(item, null, 2));
            }
            case "ack_mailbox": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
              }
              const messageId = readString(params.messageId);
              if (!messageId) {
                throw new Error("messageId is required for ack_mailbox.");
              }
              const acknowledged = await acknowledgeWorkflowMailboxMessage({
                projectRoot: resolvedProjectRoot,
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
          } catch (error) {
            await traceAction("failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };

        if (!shouldQueueWorkflowAction(action)) {
          return executeAction();
        }

        const previewState = await resolveWorkflowToolState({
          plugin,
          agentCtx: ctx,
          rawParams: params,
          autoBind: false,
        });
        return enqueueWorkflowTask({
          queueContext: resolveWorkflowToolQueueContext(previewState, ctx),
          label: `research_workflow:${action}`,
          logger: plugin.api.logger,
          task: executeAction,
        });
      },
    }),
    { optional: true }
  );
}
