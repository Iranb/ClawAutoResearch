import {
  buildFocusedPromptAssembly,
  buildWorkflowSnapshot,
  canRoleContact,
  canRoleSpawn,
  formatWorkflowSnapshotForPrompt,
  getWorkflowContactCooldown,
  inferTargetRoleFromToolParams,
  recordWorkflowContactEvent,
  sanitizeAgentMentions,
  sanitizeMessageToolParams,
  shouldBlockCoderDatasetMutation,
  shouldBlockPapernexusInlineExecution,
  shouldBlockResearchGraphForce,
  shouldBlockInnovationWrite,
  shouldBlockProjectWrite,
  shouldBlockWriterTemplateWrite,
} from "./workflow-guard";
import {
  buildPapernexusSkillBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildResumePipelineBackgroundCommand,
  hasBackgroundContinuationMarker,
} from "./workflow-fast-paths";
import {
  isWorkflowSubagentSessionKey,
  looksLikePapernexusHeavyCommand,
} from "./workflow-subagent-sessions";
import { isWorkflowStageBroadcastMessage } from "./stage-broadcast";
import {
  getToolContext,
  maybeAutoBindChannelProject,
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

async function resolveWorkflowSnapshotForAgentContext(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  autoBind?: boolean;
}) {
  const workflowPolicy = params.plugin.getWorkflowPolicy();
  const snapshot = await buildWorkflowSnapshot({
    policy: workflowPolicy,
    agentId: params.agentCtx.agentId,
    workspaceDir: params.agentCtx.workspaceDir,
    sessionKey: params.agentCtx.sessionKey,
    sessionId: params.agentCtx.sessionId,
    messageChannel: params.agentCtx.messageChannel,
  });
  if (params.autoBind !== false) {
    await maybeAutoBindChannelProject({
      policy: workflowPolicy,
      agentCtx: params.agentCtx,
      snapshot,
    });
  }
  return {
    workflowPolicy,
    snapshot,
  };
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
      const targetRole = inferTargetRoleFromToolParams(toolParams);
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

export function registerWorkflowHooks(plugin: PluginRegistrationContext) {
  if (!plugin.api.on) {
    return;
  }

  plugin.api.on(
    "before_prompt_build",
    async (event, hookCtx) => {
      const agentCtx = getToolContext(hookCtx);
      const { workflowPolicy, snapshot } = await resolveWorkflowSnapshotForAgentContext({
        plugin,
        agentCtx,
      });
      const trigger = readString(hookCtx.trigger);
      if (!workflowPolicy.injectWorkflowContext) {
        return;
      }
      if (trigger === "heartbeat" && !workflowPolicy.heartbeatBackgroundChecks) {
        return;
      }
      const latestPromptLikeText = getLatestPromptLikeText(
        Array.isArray(event.messages) ? event.messages : []
      );
      const extraContext: string[] = [];
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
        snapshot.role &&
        looksLikePapernexusHeavyCommand(latestPromptLikeText) &&
        !hasBackgroundContinuationMarker(latestPromptLikeText) &&
        !isWorkflowSubagentSessionKey(agentCtx.sessionKey)
      ) {
        extraContext.push(
          "[Slash Fast Path]",
          "This turn appears to invoke a PaperNexus-heavy skill.",
          "Before doing heavy PaperNexus work, call research_workflow with action start_background_run and backgroundRun.kind=papernexus_skill.",
          `Pass backgroundRun.commandText as: ${JSON.stringify(
            buildPapernexusSkillBackgroundCommand(latestPromptLikeText ?? "")
          )}`,
          "After the tool returns, reply briefly that the PaperNexus task has started in a dedicated subagent and stop. The background continuation will perform the real graph / PaperNexus work.",
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
      }
      const detailLevel =
        snapshot.role === "academic_writer" ||
        snapshot.role === "reviewer" ||
        snapshot.role === "cross-reviewer"
          ? "focused"
          : "full";
      const workflowPrompt =
        detailLevel === "focused"
          ? buildFocusedPromptAssembly({ snapshot }).text
          : formatWorkflowSnapshotForPrompt({
              snapshot,
              trigger,
              detailLevel,
            });
      if (detailLevel === "focused" && snapshot.projectRoot) {
        const assembly = buildFocusedPromptAssembly({ snapshot });
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
            promptLayerProfile: assembly.metadata.promptLayerProfile,
            promptPayloadSizes: assembly.metadata.promptPayloadSizes,
            sectionContextId: assembly.metadata.sectionContextId,
            reviewLane: assembly.metadata.reviewLane,
            roundId: assembly.metadata.roundId,
          },
        });
      }
      return {
        prependContext: [...extraContext, workflowPrompt].filter(Boolean).join("\n"),
      };
    },
    { priority: 40 }
  );

  plugin.api.on(
    "before_tool_call",
    async (event, hookCtx) => {
      const agentCtx = getToolContext(hookCtx);
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

  plugin.api.on(
    "subagent_spawning",
    async (event, hookCtx) => {
      const workflowPolicy = plugin.getWorkflowPolicy();
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
      const requesterCtx = buildRequesterToolContext(hookCtx, requesterRole);
      const { snapshot } = await resolveWorkflowSnapshotForAgentContext({
        plugin,
        agentCtx: requesterCtx,
        autoBind: false,
      });
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
    { priority: 45 }
  );
}
