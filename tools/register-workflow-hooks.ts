import { createHash } from "node:crypto";
import {
  buildFocusedPromptAssembly,
  buildWorkflowSnapshot,
  canRoleContactInWorkflow,
  canRoleSpawnInWorkflow,
  formatWorkflowSnapshotForPrompt,
  getWorkflowContactCooldown,
  inferTargetRoleFromToolParams,
  normalizeWorkflowChannelMentions,
  recordWorkflowContactEvent,
  sanitizeMessageToolParams,
  shouldUseFocusedWorkflowPrompt,
  shouldBlockCoderDatasetMutation,
  shouldBlockPapernexusDestructiveOperation,
  shouldBlockPapernexusInlineExecution,
  shouldBlockPapernexusLongWaitImportCommand,
  shouldBlockPapernexusLocalGraphProcessing,
  shouldBlockPapernexusLocalStorageUsage,
  shouldBlockPapernexusLiveGraphCliRead,
  shouldBlockPapernexusMultiPaperImport,
  shouldBlockPapernexusRawHttpUsage,
  shouldBlockResearchGraphForce,
  shouldBlockInnovationWrite,
  shouldBlockProjectWrite,
  shouldBlockWriterTemplateWrite,
} from "./workflow-guard";
import {
  buildLiteratureReviewBackgroundCommand,
  buildPapernexusSkillBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildResumePipelineBackgroundCommand,
  buildSurveyReviewBackgroundCommand,
  hasBackgroundContinuationMarker,
} from "./workflow-fast-paths";
import { resolveBindingChannelKeyFromContext } from "./workflow-commands/parsers.js";
import { ensureProjectsBindingIndex } from "./channel-project-bindings";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { autoAcknowledgeWorkflowMailboxForAgent } from "./workflow-handoff-runtime";
import { claimAndActivateWorkflowHandoffForAgent } from "./workflow-handoff/handoff-activation";
import { normalizePaperIngestionState } from "./workflow-guard-state/paper-ingestion";
import { isLiteratureDiscoveryTriggerKind } from "./literature-discovery/workflow-bridge";
import {
  isWorkflowSubagentSessionKey,
  looksLikePapernexusHeavyCommand,
} from "./workflow-subagent-sessions";
import { isWorkflowManagedAgentContext } from "./workflow-agent-isolation.js";
import { isWorkflowStageBroadcastMessage } from "./stage-broadcast";
import { inspectWorkflowLobsterReadiness, normalizeWorkflowLobsterHandoffConfig } from "./lobster-handoff";
import {
  getToolContext,
  readString,
  requireObject,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";
import {
  buildWorkflowQueueContext,
  enqueueWorkflowTask,
} from "./workflow-coordination";
import { appendWorkflowTraceEvent } from "./workflow-trace";
import { resolveWorkflowSnapshotContext } from "./workflow-runtime-snapshot";
import { claimNextWorkflowTaskForOwner } from "./workflow-team/task-graph";
import { recordWorkflowTeamRoundClaim } from "./workflow-team/team-round";
import { upsertWorkflowAgentCapability } from "./workflow-handoff/agent-capabilities";
import { runWorkflowHookPointGate } from "./workflow-hooks/gateways.js";
import { createWorkflowExecutionRuntimeFromApi } from "./workflow-execution-runtime.js";

const WORKFLOW_GUARD_ALLOWED_AGENT_IDS = [
  "researcher",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
  "cross-reviewer",
] as const;

const WORKFLOW_PROMPT_INJECTION_CACHE = new Map<
  string,
  { fingerprint: string; injectedAt: number }
>();
const WORKFLOW_PROMPT_INJECTION_CACHE_MAX = 512;

function hashPromptState(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 16);
}

function rememberWorkflowPromptInjection(params: {
  sessionKey: string | null | undefined;
  fingerprint: string;
}) {
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey) {
    return;
  }
  WORKFLOW_PROMPT_INJECTION_CACHE.set(sessionKey, {
    fingerprint: params.fingerprint,
    injectedAt: Date.now(),
  });
  if (WORKFLOW_PROMPT_INJECTION_CACHE.size <= WORKFLOW_PROMPT_INJECTION_CACHE_MAX) {
    return;
  }
  const oldest = [...WORKFLOW_PROMPT_INJECTION_CACHE.entries()].sort(
    (left, right) => left[1].injectedAt - right[1].injectedAt
  )[0]?.[0];
  if (oldest) {
    WORKFLOW_PROMPT_INJECTION_CACHE.delete(oldest);
  }
}

function isExplicitWorkflowHookAgent(agentCtx: ToolContext): boolean {
  return isWorkflowManagedAgentContext({
    agentId: agentCtx.agentId,
    allowedRoles: WORKFLOW_GUARD_ALLOWED_AGENT_IDS,
    allowSessionKeyInference: false,
  });
}

function collectStringFragments(value: unknown, acc: string[], depth = 0): void {
  if (depth > 4 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      acc.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringFragments(item, acc, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "text", "body", "prompt", "message"]) {
      if (key in record) {
        collectStringFragments(record[key], acc, depth + 1);
      }
    }
  }
}

function getLatestPromptLikeText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fragments: string[] = [];
    collectStringFragments(messages[index], fragments);
    const joined = fragments.join("\n").trim();
    if (joined) {
      return joined;
    }
  }
  return null;
}

function looksLikeResearchPipelineCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/research-pipeline\b/i.test(text));
}

function looksLikeResearchQueueCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/research-queue\b/i.test(text));
}

function looksLikeResumePipelineCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/resume-pipeline\b/i.test(text));
}

function looksLikeLiteratureReviewCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/literature-review\b/i.test(text));
}

function looksLikeSurveyPipelineCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/survey-pipeline\b/i.test(text));
}

function looksLikePaperPlanCommand(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\/paper-plan\b/i.test(text));
}

function looksLikeExplicitWorkflowCommand(text: string | null | undefined): boolean {
  return Boolean(
    text &&
      /^\s*\/(?:research-pipeline|research-queue|survey-pipeline|literature-review|resume-pipeline|paper-plan|graph-build|auto-review|auto-research|zotero-sync|papernexus-reflection)\b/i.test(
        text
      )
  );
}

function looksLikeInjectedWorkflowGuard(text: string | null | undefined): boolean {
  return Boolean(text && /\[Workflow Guard\]/i.test(text));
}

function snapshotHasWorkflowProject(snapshot: Record<string, unknown>): boolean {
  return Boolean(readString(snapshot.projectRoot) ?? readString(snapshot.project_root));
}

function buildPromptInjectionFingerprint(params: {
  snapshot: Record<string, unknown>;
  trigger: string | null;
  extraContext: string[];
  heartbeatClaimedTaskId: string | null;
}) {
  const snapshot = params.snapshot;
  return hashPromptState({
    projectRoot: readString(snapshot.projectRoot) ?? readString(snapshot.project_root),
    projectId: readString(snapshot.projectId) ?? readString(snapshot.project_id),
    role: readString(snapshot.role),
    ownerAgent: readString(snapshot.ownerAgent) ?? readString(snapshot.owner_agent),
    currentStage: readString(snapshot.currentStage) ?? readString(snapshot.current_stage),
    currentMicroStage:
      readString(snapshot.currentMicroStage) ?? readString(snapshot.current_micro_stage),
    nextAction: readString(snapshot.nextAction) ?? readString(snapshot.next_action),
    pendingHandoffId:
      readString(snapshot.pendingHandoffId) ?? readString(snapshot.pending_handoff_id),
    missingStageSignals: Array.isArray(snapshot.missingStageSignals)
      ? snapshot.missingStageSignals
      : Array.isArray(snapshot.missing_stage_signals)
        ? snapshot.missing_stage_signals
        : [],
    trigger: params.trigger,
    extraContextHash: hashPromptState(params.extraContext),
    heartbeatClaimedTaskId: params.heartbeatClaimedTaskId,
  });
}

function shouldSkipWorkflowPromptInjection(params: {
  snapshot: Record<string, unknown>;
  trigger: string | null;
  latestPromptLikeText: string | null;
  heartbeatClaimedTaskId: string | null;
  fingerprint: string;
  sessionKey?: string | null;
}) {
  const hasProject = snapshotHasWorkflowProject(params.snapshot);
  const explicitCommand = looksLikeExplicitWorkflowCommand(params.latestPromptLikeText);
  const guardEcho = looksLikeInjectedWorkflowGuard(params.latestPromptLikeText);
  if (!hasProject && !explicitCommand && !params.heartbeatClaimedTaskId) {
    return true;
  }
  if (!hasProject && guardEcho && !params.heartbeatClaimedTaskId) {
    return true;
  }
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey) {
    return false;
  }
  const cached = WORKFLOW_PROMPT_INJECTION_CACHE.get(sessionKey);
  if (!cached || cached.fingerprint !== params.fingerprint) {
    return false;
  }
  if (params.trigger === "heartbeat") {
    return true;
  }
  return guardEcho;
}

export function resolveQueuedLiteratureDiscoveryForegroundFastPath(params: {
  paperIngestion: unknown;
}): {
  requestId: string;
  commandText: string;
  status: "queued" | "needs_repair";
} | null {
  const state = normalizePaperIngestionState(params.paperIngestion);
  const queuedRequest =
    state.queuedRequests.find(
      (entry) =>
        isLiteratureDiscoveryTriggerKind(entry.triggerKind) &&
        (entry.status === "queued" || entry.status === "needs_repair") &&
        typeof entry.commandText === "string" &&
        entry.commandText.trim().length > 0
    ) ?? null;
  if (!queuedRequest?.requestId || !queuedRequest.commandText) {
    return null;
  }
  return {
    requestId: queuedRequest.requestId,
    commandText: buildResearchQueueBackgroundCommand(queuedRequest.commandText),
    status: queuedRequest.status === "needs_repair" ? "needs_repair" : "queued",
  };
}

async function loadQueuedLiteratureDiscoveryForegroundFastPath(
  projectRoot: string | null | undefined
): Promise<ReturnType<typeof resolveQueuedLiteratureDiscoveryForegroundFastPath>> {
  const root = readString(projectRoot);
  if (!root) {
    return null;
  }
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(`${root}/PROJECT_MANIFEST.json`)) ?? null;
  if (!manifest) {
    return null;
  }
  return resolveQueuedLiteratureDiscoveryForegroundFastPath({
    paperIngestion: manifest.paper_ingestion,
  });
}

async function resolveWorkflowSnapshotForAgentContext(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  autoBind?: boolean;
}) {
  return resolveWorkflowSnapshotContext({
    plugin: params.plugin,
    agentCtx: params.agentCtx,
    autoBind: params.autoBind,
    stagePreflight: false,
    preflightTrigger: "workflow_hook:prompt_or_tool",
  });
}

function createWorkflowHookRuntime(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  projectRoot?: string | null;
}) {
  return createWorkflowExecutionRuntimeFromApi({
    api: params.plugin.api,
    defaultWorkspaceDir:
      readString(params.projectRoot) ??
      readString(params.agentCtx.workspaceDir) ??
      undefined,
    defaultAgentId: readString(params.agentCtx.agentId) ?? undefined,
    defaultMessageChannel: readString(params.agentCtx.messageChannel) ?? undefined,
  });
}

function buildRequesterToolContext(
  hookCtx: Record<string, unknown>,
  requesterRole: string
): ToolContext {
  return {
    agentId: requesterRole,
    workspaceDir: readString(hookCtx.workspaceDir),
    sessionKey: readString(hookCtx.requesterSessionKey),
    sessionId: readString(hookCtx.requesterSessionId),
    messageChannel: readString(hookCtx.messageChannel),
    channelKey:
      resolveBindingChannelKeyFromContext({
        channel: readString(hookCtx.channel),
        messageChannel: readString(hookCtx.messageChannel),
        from: readString(hookCtx.from),
        to: readString(hookCtx.to),
        accountId: readString(hookCtx.accountId),
        conversationId: readString(hookCtx.conversationId),
        messageThreadId:
          typeof hookCtx.messageThreadId === "number"
            ? hookCtx.messageThreadId
            : undefined,
        threadId:
          typeof hookCtx.threadId === "number" || typeof hookCtx.threadId === "string"
            ? hookCtx.threadId
            : null,
        channelKey:
          readString(hookCtx.channelKey) ??
          readString(hookCtx.threadBindingKey) ??
          readString(hookCtx.bindingConversationId),
      }) ?? undefined,
  };
}

function shouldQueueBeforeToolCall(toolName: string): boolean {
  return toolName === "sessions_send" || toolName === "sessions_spawn";
}

function resolveWorkflowHookQueueContext(
  agentCtx: ToolContext,
  snapshot: Awaited<ReturnType<typeof buildWorkflowSnapshot>>
) {
  return buildWorkflowQueueContext({
    projectRoot: snapshot.projectRoot,
    workspaceDir: agentCtx.workspaceDir,
    sessionKey: agentCtx.sessionKey,
    sessionId: agentCtx.sessionId,
    messageChannel: agentCtx.messageChannel,
    channelKey: snapshot.channelProjectBindingKey,
  });
}

async function runBeforeToolCallHook(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  event: Record<string, unknown>;
}) {
  const { workflowPolicy, snapshot } = await resolveWorkflowSnapshotForAgentContext({
    plugin: params.plugin,
    agentCtx: params.agentCtx,
  });
  const toolName = String(params.event.toolName ?? "");
  const toolParams = requireObject<Record<string, unknown>>(
    params.event.params,
    "tool params"
  );

  if (workflowPolicy.enforceWorkflowBoundaries) {
    const writeCheck = shouldBlockProjectWrite({
      role: snapshot.role,
      projectRoot: snapshot.projectRoot,
      toolName,
      toolParams,
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
      toolParams,
    });
    if (coderDatasetCheck.block) {
      return {
        block: true,
        blockReason: coderDatasetCheck.reason,
      };
    }

    const researchGraphForceCheck = shouldBlockResearchGraphForce({
      role: snapshot.role,
      currentStage: snapshot.currentStage,
      toolName,
      toolParams,
    });
    if (researchGraphForceCheck.block) {
      return {
        block: true,
        blockReason: researchGraphForceCheck.reason,
      };
    }

    const papernexusCliReadCheck = shouldBlockPapernexusLiveGraphCliRead({
      role: snapshot.role,
      toolName,
      toolParams,
    });
    if (papernexusCliReadCheck.block) {
      return {
        block: true,
        blockReason: papernexusCliReadCheck.reason,
      };
    }

    const papernexusLocalGraphProcessingCheck = shouldBlockPapernexusLocalGraphProcessing({
      role: snapshot.role,
      toolName,
      toolParams,
      remoteApiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
      remoteMcpUrl: workflowPolicy.papernexusMcpUrl,
    });
    if (papernexusLocalGraphProcessingCheck.block) {
      return {
        block: true,
        blockReason: papernexusLocalGraphProcessingCheck.reason,
      };
    }

    const papernexusLocalStorageCheck = shouldBlockPapernexusLocalStorageUsage({
      role: snapshot.role,
      toolName,
      toolParams,
      remoteApiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
      remoteMcpUrl: workflowPolicy.papernexusMcpUrl,
    });
    if (papernexusLocalStorageCheck.block) {
      return {
        block: true,
        blockReason: papernexusLocalStorageCheck.reason,
      };
    }

    const papernexusMultiPaperImportCheck = shouldBlockPapernexusMultiPaperImport({
      role: snapshot.role,
      toolName,
      toolParams,
    });
    if (papernexusMultiPaperImportCheck.block) {
      return {
        block: true,
        blockReason: papernexusMultiPaperImportCheck.reason,
      };
    }

    const papernexusLongWaitImportCheck = shouldBlockPapernexusLongWaitImportCommand({
      role: snapshot.role,
      toolName,
      toolParams,
    });
    if (papernexusLongWaitImportCheck.block) {
      return {
        block: true,
        blockReason: papernexusLongWaitImportCheck.reason,
      };
    }

    const papernexusRawHttpCheck = shouldBlockPapernexusRawHttpUsage({
      role: snapshot.role,
      toolName,
      toolParams,
    });
    if (papernexusRawHttpCheck.block) {
      return {
        block: true,
        blockReason: papernexusRawHttpCheck.reason,
      };
    }

    const papernexusInlineCheck = shouldBlockPapernexusInlineExecution({
      role: snapshot.role,
      toolName,
      toolParams,
      sessionKey: params.agentCtx.sessionKey,
    });
    if (papernexusInlineCheck.block) {
      return {
        block: true,
        blockReason: papernexusInlineCheck.reason,
      };
    }

    const papernexusDestructiveCheck = shouldBlockPapernexusDestructiveOperation({
      role: snapshot.role,
      toolName,
      toolParams,
    });
    if (papernexusDestructiveCheck.block) {
      return {
        block: true,
        blockReason: papernexusDestructiveCheck.reason,
      };
    }

    const innovationWriteCheck = shouldBlockInnovationWrite({
      role: snapshot.role,
      projectRoot: snapshot.projectRoot,
      currentStage: snapshot.currentStage,
      innovationReflectionDue: snapshot.innovationReflectionDue,
      toolName,
      toolParams,
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
      toolParams,
    });
    if (writerTemplateCheck.block) {
      return {
        block: true,
        blockReason: writerTemplateCheck.reason,
      };
    }

    if (toolName === "sessions_spawn") {
      const targetRole = inferTargetRoleFromToolParams(toolParams);
      if (!snapshot.role) {
        return {
          block: true,
          blockReason:
            "Cannot determine requester role for sessions_spawn. Retry after workflow runtime context is restored.",
        };
      }
      if (
        !targetRole ||
        !canRoleSpawnInWorkflow({
          fromRole: snapshot.role,
          toRole: targetRole,
          currentStage: snapshot.currentStage,
        })
      ) {
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
      const targetRole = inferTargetRoleFromToolParams(toolParams);
      if (!snapshot.role) {
        return {
          block: true,
          blockReason:
            "Cannot determine requester role for sessions_send. Retry after workflow runtime context is restored.",
        };
      }
      if (
        !targetRole ||
        !canRoleContactInWorkflow({
          fromRole: snapshot.role,
          toRole: targetRole,
          currentStage: snapshot.currentStage,
        })
      ) {
        return {
          block: true,
          blockReason: `${snapshot.role} should not send ad hoc internal messages to ${targetRole ?? "that target"}. Prefer the workflow runtime/orchestrator handoff path; use research_workflow.send_mailbox only as a compatibility fallback.`,
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
    const sanitized = sanitizeMessageToolParams(toolParams);
    if (sanitized) {
      return {
        params: sanitized,
      };
    }
  }

  return;
}

async function runSubagentSpawningHook(params: {
  plugin: PluginRegistrationContext;
  event: Record<string, unknown>;
  hookCtx: Record<string, unknown>;
  requesterRole: string;
  childRole: string;
}) {
  const requesterCtx = buildRequesterToolContext(params.hookCtx, params.requesterRole);
  const { snapshot } = await resolveWorkflowSnapshotForAgentContext({
    plugin: params.plugin,
    agentCtx: requesterCtx,
  });

  if (params.childRole === "coder") {
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
  }

  if (snapshot.projectRoot) {
    await recordWorkflowContactEvent({
      projectRoot: snapshot.projectRoot,
      fromAgent: params.requesterRole,
      toAgent: params.childRole,
      channel: "sessions_spawn",
    });
  }
  return;
}

async function runWorkflowHookSafely<T>(params: {
  plugin: PluginRegistrationContext;
  hookName: string;
  agentCtx?: ToolContext | null;
  task: () => Promise<T>;
}): Promise<T | undefined> {
  try {
    return await params.task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.plugin.api.logger?.warn?.(
      `Workflow hook ${params.hookName} failed; continuing without hook output.`,
      {
        hook: params.hookName,
        agentId: params.agentCtx?.agentId ?? null,
        sessionKey: params.agentCtx?.sessionKey ?? null,
        workspaceDir: params.agentCtx?.workspaceDir ?? null,
        error: message,
      }
    );
    return undefined;
  }
}

export function registerWorkflowHooks(plugin: PluginRegistrationContext) {
  if (!plugin.api.on) {
    return;
  }

  plugin.api.on(
    "before_prompt_build",
    async (event, hookCtx) => {
      const agentCtx = getToolContext(hookCtx);
      if (!isExplicitWorkflowHookAgent(agentCtx)) {
        return;
      }
      return runWorkflowHookSafely({
        plugin,
        hookName: "before_prompt_build",
        agentCtx,
        task: async () => {
          const { workflowPolicy, snapshot: initialSnapshot } = await resolveWorkflowSnapshotForAgentContext({
            plugin,
            agentCtx,
            autoBind: false,
          });
          let snapshot = initialSnapshot;
          if (
            workflowPolicy.enableChannelProjectBindings &&
            workflowPolicy.projectsRoot
          ) {
            await ensureProjectsBindingIndex({
              projectsRoot: workflowPolicy.projectsRoot,
            });
          }
          if (snapshot.projectRoot && snapshot.role) {
            const workflowRuntime = createWorkflowHookRuntime({
              plugin,
              agentCtx,
              projectRoot: snapshot.projectRoot,
            });
            if (agentCtx.sessionKey) {
              const lobsterReadiness = await inspectWorkflowLobsterReadiness({
                config: normalizeWorkflowLobsterHandoffConfig(
                  workflowPolicy.lobsterHandoff
                ),
                autoModeActive: workflowPolicy.autoMode !== "off",
              }).catch(() => null);
              await upsertWorkflowAgentCapability({
                projectRoot: snapshot.projectRoot,
                projectId: snapshot.projectId,
                sessionKey: agentCtx.sessionKey,
                sessionId: agentCtx.sessionId,
                role: snapshot.role,
                agentId: agentCtx.agentId,
                messageChannel: agentCtx.messageChannel,
                canUseResearchWorkflow: true,
                canReceiveNativeDispatch: true,
                canRunExecPacket: true,
                canUseLobster: lobsterReadiness?.status === "ready",
                confidence: "high",
              }).catch(() => null);
            }
            await autoAcknowledgeWorkflowMailboxForAgent({
              projectRoot: snapshot.projectRoot,
              agentId: snapshot.role,
              handoffOnly: true,
            });
            const claimedHandoff = await claimAndActivateWorkflowHandoffForAgent({
              projectRoot: snapshot.projectRoot,
              role: snapshot.role,
              sessionKey: agentCtx.sessionKey,
              claimLeaseMs: 15 * 60 * 1000,
              beforeActivateHook: async ({ intent, stageAfter }) => {
                const hookSummary = await runWorkflowHookPointGate({
                  runtimeSubagent: workflowRuntime,
                  projectRoot: snapshot.projectRoot!,
                  projectId: snapshot.projectId,
                  stage: stageAfter,
                  hookPoint: "before_handoff_activation",
                  ownerRole: snapshot.role,
                  actorRole: snapshot.role,
                  requesterSessionKey: agentCtx.sessionKey,
                  requesterChannel: agentCtx.messageChannel,
                  handoffIntentId: intent.intentId,
                  targetStage: stageAfter,
                  transition: "prompt_handoff_activation",
                });
                return {
                  allow: hookSummary.aggregateVerdict === "pass",
                  blockingReason: hookSummary.blockingReason,
                };
              },
              afterActivateHook: async ({ intent, stageAfter }) => {
                await runWorkflowHookPointGate({
                  runtimeSubagent: workflowRuntime,
                  projectRoot: snapshot.projectRoot!,
                  projectId: snapshot.projectId,
                  stage: stageAfter,
                  hookPoint: "after_handoff_activation",
                  ownerRole: snapshot.role,
                  actorRole: snapshot.role,
                  requesterSessionKey: agentCtx.sessionKey,
                  requesterChannel: agentCtx.messageChannel,
                  handoffIntentId: intent.intentId,
                  targetStage: stageAfter,
                  transition: "prompt_handoff_activation",
                });
              },
            }).catch(() => null);
            if (claimedHandoff?.claimed) {
              const refreshed = await resolveWorkflowSnapshotForAgentContext({
                plugin,
                agentCtx,
                autoBind: false,
              }).catch(() => null);
              if (refreshed?.snapshot) {
                snapshot = refreshed.snapshot;
              }
            }
          }
          const trigger = readString(hookCtx.trigger);
          let heartbeatClaimedTaskId: string | null = null;
          if (
            trigger === "heartbeat" &&
            workflowPolicy.teamRuntime?.enabled !== false &&
            snapshot.projectRoot &&
            snapshot.role &&
            agentCtx.sessionKey
          ) {
            const claimed = await claimNextWorkflowTaskForOwner({
              projectRoot: snapshot.projectRoot,
              owner: snapshot.role,
              sessionKey: agentCtx.sessionKey,
            }).catch(() => null);
            if (claimed?.claimed && claimed.task) {
              heartbeatClaimedTaskId = claimed.task.taskId;
              await recordWorkflowTeamRoundClaim({
                projectRoot: snapshot.projectRoot,
                sessionKey: agentCtx.sessionKey,
                taskId: claimed.task.taskId,
              }).catch(() => null);
            }
          }
          if (!workflowPolicy.injectWorkflowContext) {
            return;
          }
          if (trigger === "heartbeat" && !workflowPolicy.heartbeatBackgroundChecks) {
            return;
          }
          const latestPromptLikeText = getLatestPromptLikeText(
            Array.isArray(event.messages) ? event.messages : []
          );
          const queuedLiteratureDiscoveryFastPath =
            snapshot.role === "researcher" &&
            !isWorkflowSubagentSessionKey(agentCtx.sessionKey)
              ? await loadQueuedLiteratureDiscoveryForegroundFastPath(snapshot.projectRoot)
              : null;
          const extraContext: string[] = [];
          if (snapshot.currentStage === "survey_review" || snapshot.writingPaperMode === "survey") {
            extraContext.push(
              "[Survey Route Guard]",
              "This is a survey workflow. Do not hand-edit PROJECT_MANIFEST.json.current_stage to skip stages, and do not create coder/experiments stubs or fake experiment manifests.",
              "Use research_workflow.recover_survey_route or research_workflow.materialize_survey_review_state when the workflow drifts toward idea/plan/code/experiment/analyze.",
              "[/Survey Route Guard]"
            );
          }
          if (heartbeatClaimedTaskId) {
            extraContext.push(
              "[TeammateIdle Continuation]",
              `A claimable workflow team task was assigned during heartbeat: ${heartbeatClaimedTaskId}.`,
              "Continue that task now. When the durable outputs are ready, call research_workflow.complete_task with this taskId so verification can either mark it satisfied or return repair feedback, then auto-claim the next task if one is available.",
              "[/TeammateIdle Continuation]"
            );
          }
          if (
            snapshot.role === "researcher" &&
            looksLikeResearchPipelineCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to come from /research-pipeline.",
              "Before doing heavy work, call research_workflow with action start_background_run and backgroundRun.kind=research_pipeline.",
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildResearchPipelineBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "After the tool returns, reply briefly that the research pipeline has started and stop. The background continuation will perform the real workflow.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role === "researcher" &&
            looksLikeResearchQueueCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to come from /research-queue.",
              "Before doing heavy work, call research_workflow with action start_background_run and backgroundRun.kind=research_queue.",
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildResearchQueueBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "After the tool returns, reply briefly that the research queue task has started and stop. The background continuation will perform the real queue workflow.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role === "researcher" &&
            snapshot.projectRoot &&
            looksLikeLiteratureReviewCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to come from /literature-review.",
              'Before doing heavy review work, call research_workflow with action start_background_run and backgroundRun.kind="literature_review".',
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildLiteratureReviewBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "Keep the pass project-scoped, durable, and bounded. After the tool returns, reply briefly that the background literature review has started and stop. The background continuation will materialize the real review packet.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role === "researcher" &&
            looksLikeSurveyPipelineCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to come from /survey-pipeline.",
              'Before doing heavy survey work, call research_workflow with action start_background_run and backgroundRun.kind="survey_review".',
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildSurveyReviewBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "After the tool returns, reply briefly that the background survey pipeline has started and stop. The background continuation will materialize the real survey packet.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role === "researcher" &&
            snapshot.currentStage === "survey_review" &&
            looksLikePaperPlanCommand(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Survey Paper Plan]",
              "This is a survey workflow. Do not route /paper-plan through the experiment-paper plan/code/experiment stages.",
              "First call research_workflow.materialize_survey_review_state to reconcile SURVEY_QUERY_REGISTRY.json, INCLUDED_PAPERS.json, EXCLUDED_PAPERS.json, SOTA_MATRIX.md, GAP_SYNTHESIS.md, COVERAGE_SUMMARY.md, and SURVEY_BRIEF.md.",
              "Then draft or update the survey outline/taxonomy plan under researcher/SURVEY_OUTLINE.md or academic_writer/PAPER_PLAN.md using the survey_review packet as the source of truth.",
              "Do not create coder/experiments stubs or fake experiment manifests for survey papers.",
              "[/Survey Paper Plan]"
            );
          } else if (
            snapshot.role &&
            looksLikePapernexusHeavyCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText) &&
            !isWorkflowSubagentSessionKey(agentCtx.sessionKey)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to invoke authenticated PaperNexus live-graph work.",
              "Before calling remote typed PaperNexus APIs or other heavy graph work, prefer research_workflow with action run_papernexus_wrapper when you know the wrapper and args. Legacy compatibility fallback: call start_background_run with backgroundRun.kind=papernexus_wrapper and an explicit wrapper commandText.",
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildPapernexusSkillBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "After the tool returns, reply briefly that the PaperNexus wrapper task has started in a dedicated subagent and stop. The background continuation will perform the real typed brief / brainstorm / evidence / graph work.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role &&
            looksLikeResumePipelineCommand(latestPromptLikeText) &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Slash Fast Path]",
              "This turn appears to come from /resume-pipeline.",
              "Before doing heavy reconciliation work, call research_workflow with action start_background_run and backgroundRun.kind=resume_pipeline.",
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                buildResumePipelineBackgroundCommand(latestPromptLikeText ?? "")
              )}`,
              "After the tool returns, reply briefly that the resume pipeline task has started and stop. The background continuation will perform the actual reconciliation.",
              "[/Slash Fast Path]"
            );
          } else if (
            snapshot.role === "researcher" &&
            queuedLiteratureDiscoveryFastPath &&
            !hasBackgroundContinuationMarker(latestPromptLikeText)
          ) {
            extraContext.push(
              "[Workflow-Owned Literature Fast Path]",
              `A workflow-owned literature discovery request (${queuedLiteratureDiscoveryFastPath.requestId}) is ${queuedLiteratureDiscoveryFastPath.status} for this project.`,
              "If the current turn needs you to continue that queued literature-discovery pass, do not execute the full pass inline in this foreground Researcher session.",
              'Instead call research_workflow with action start_background_run and backgroundRun.kind="research_queue".',
              `Pass backgroundRun.commandText as: ${JSON.stringify(
                queuedLiteratureDiscoveryFastPath.commandText
              )}`,
              "After the tool returns, reply briefly that the background literature-discovery pass has started. If the user asked a direct question or status check, answer it normally in the foreground while the background session continues.",
              "Do not start a duplicate run if the queue entry is no longer queued by the time you act.",
              "[/Workflow-Owned Literature Fast Path]"
            );
          }
          const promptFingerprint = buildPromptInjectionFingerprint({
            snapshot: snapshot as Record<string, unknown>,
            trigger: trigger ?? null,
            extraContext,
            heartbeatClaimedTaskId,
          });
          if (
            shouldSkipWorkflowPromptInjection({
              snapshot: snapshot as Record<string, unknown>,
              trigger: trigger ?? null,
              latestPromptLikeText,
              heartbeatClaimedTaskId,
              fingerprint: promptFingerprint,
              sessionKey: agentCtx.sessionKey,
            })
          ) {
            return;
          }
          const detailLevel = shouldUseFocusedWorkflowPrompt(snapshot) ? "focused" : "full";
          const focusedAssembly =
            detailLevel === "focused"
              ? buildFocusedPromptAssembly({ snapshot, trigger })
              : null;
          const workflowPrompt =
            focusedAssembly?.text ??
            formatWorkflowSnapshotForPrompt({
              snapshot,
              trigger,
              detailLevel,
            });
          if (detailLevel === "focused" && snapshot.projectRoot) {
            await appendWorkflowTraceEvent({
              projectRoot: snapshot.projectRoot,
              projectId: snapshot.projectId,
              kind: "prompt_assembly",
              action: "focused_prompt_build",
              functionName: "buildFocusedPromptAssembly",
              stage: snapshot.currentStage,
              owner: snapshot.ownerAgent,
              agentId: snapshot.role,
              sessionKey: agentCtx.sessionKey,
              summary: `Focused prompt assembled for ${snapshot.role ?? "agent"}`,
              details: {
                trigger,
                promptLayerProfile: focusedAssembly?.metadata.promptLayerProfile,
                promptPayloadSizes: focusedAssembly?.metadata.promptPayloadSizes,
                sectionContextId: focusedAssembly?.metadata.sectionContextId,
                reviewLane: focusedAssembly?.metadata.reviewLane,
                roundId: focusedAssembly?.metadata.roundId,
              },
            });
          }
          rememberWorkflowPromptInjection({
            sessionKey: agentCtx.sessionKey,
            fingerprint: promptFingerprint,
          });
          return {
            prependContext: [...extraContext, workflowPrompt].filter(Boolean).join("\n"),
          };
        },
      });
    },
    { priority: 40 }
  );

  plugin.api.on(
    "before_tool_call",
    async (event, hookCtx) => {
      const agentCtx = getToolContext(hookCtx);
      if (!isExplicitWorkflowHookAgent(agentCtx)) {
        return;
      }
      return runWorkflowHookSafely({
        plugin,
        hookName: "before_tool_call",
        agentCtx,
        task: async () => {
          const toolName = String(event.toolName ?? "");
          if (!shouldQueueBeforeToolCall(toolName)) {
            return runBeforeToolCallHook({
              plugin,
              agentCtx,
              event,
            });
          }

          const { snapshot } = await resolveWorkflowSnapshotForAgentContext({
            plugin,
            agentCtx,
            autoBind: false,
          });
          return enqueueWorkflowTask({
            queueContext: resolveWorkflowHookQueueContext(agentCtx, snapshot),
            label: `hook:before_tool_call:${toolName}`,
            logger: plugin.api.logger,
            task: () =>
              runBeforeToolCallHook({
                plugin,
                agentCtx,
                event,
              }),
          });
        },
      });
    },
    { priority: 50 }
  );

  plugin.api.on(
    "message_sending",
    async (event, hookCtx) => {
      const workflowPolicy = plugin.getWorkflowPolicy();
      const channelId = readString(hookCtx.channelId)?.toLowerCase();
      const content = readString(event.content);
      if (!workflowPolicy.blockDiscordAgentMentions || channelId !== "discord" || !content) {
        return;
      }
      if (isWorkflowStageBroadcastMessage(content)) {
        return;
      }
      const sanitized = normalizeWorkflowChannelMentions(content);
      if (sanitized === content) {
        return;
      }
      return {
        content: sanitized,
      };
    },
    { priority: 40 }
  );

  plugin.api.on(
    "subagent_spawning",
    async (event, hookCtx) => {
      const workflowPolicy = plugin.getWorkflowPolicy();
      if (!workflowPolicy.enforceWorkflowBoundaries) {
        return;
      }
      const requesterAgentCtx = getToolContext(hookCtx);
      if (!isExplicitWorkflowHookAgent(requesterAgentCtx)) {
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
      const requesterCtx = buildRequesterToolContext(hookCtx, requesterRole);
      return runWorkflowHookSafely({
        plugin,
        hookName: "subagent_spawning",
        agentCtx: requesterCtx,
        task: async () => {
          const { snapshot } = await resolveWorkflowSnapshotForAgentContext({
            plugin,
            agentCtx: requesterCtx,
            autoBind: false,
          });
          if (
            !canRoleSpawnInWorkflow({
              fromRole: requesterRole,
              toRole: childRole,
              currentStage: snapshot.currentStage,
            })
          ) {
            return {
              status: "error",
              error: `${requesterRole} cannot spawn ${childRole} in this workflow.`,
            };
          }
          return enqueueWorkflowTask({
            queueContext: resolveWorkflowHookQueueContext(requesterCtx, snapshot),
            label: `hook:subagent_spawning:${requesterRole}->${childRole}`,
            logger: plugin.api.logger,
            task: () =>
              runSubagentSpawningHook({
                plugin,
                event,
                hookCtx,
                requesterRole,
                childRole,
              }),
          });
        },
      });
    },
    { priority: 45 }
  );
}
