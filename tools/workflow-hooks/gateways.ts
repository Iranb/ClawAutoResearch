import { deriveAgentSessionKeyForRole } from "../agent-task-dispatch";
import { evaluateWorkflowHooksForPoint } from "./executor.js";
import { buildWorkflowHookPointContext } from "./point-context.js";
import type { WorkflowHookPoint } from "./contracts.js";

type RuntimeSubagentApi = {
  run?: (params: {
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
};

function extractLatestReadableText(messages: unknown[]): string | null {
  for (const entry of [...messages].reverse()) {
    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const serialized = JSON.stringify(entry);
    if (serialized.trim()) {
      return serialized;
    }
  }
  return null;
}

function normalizeHookReviewerRole(
  value: string | null | undefined
): Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"] | null {
  if (
    value === "researcher" ||
    value === "planner" ||
    value === "orchestrator" ||
    value === "coder" ||
    value === "analyzer" ||
    value === "academic_writer" ||
    value === "reviewer" ||
    value === "cross-reviewer"
  ) {
    return value;
  }
  return null;
}

export async function runWorkflowHookPointGate(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  ownerRole?: string | null;
  actorRole?: string | null;
  requesterSessionKey?: string | null;
  requesterChannel?: string | null;
  taskId?: string | null;
  handoffIntentId?: string | null;
}) {
  return evaluateWorkflowHooksForPoint({
    runtimeSubagent: params.runtimeSubagent,
    requesterSessionKey: params.requesterSessionKey,
    requesterChannel: params.requesterChannel,
    context: buildWorkflowHookPointContext({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      stage: params.stage,
      hookPoint: params.hookPoint,
      ownerRole: params.ownerRole,
      actorRole: params.actorRole,
      taskId: params.taskId,
      handoffIntentId: params.handoffIntentId,
    }),
    launchReviewerRun:
      params.runtimeSubagent?.run != null
        ? async (launchParams) => {
            const reviewerRole = normalizeHookReviewerRole(launchParams.reviewerRole);
            if (!reviewerRole) {
              return {
                launched: false,
                runId: null,
                sessionKey: launchParams.sessionKey,
                error: `Unsupported hook reviewer role: ${launchParams.reviewerRole}`,
              };
            }
            const sessionKey = deriveAgentSessionKeyForRole({
              requesterSessionKey: params.requesterSessionKey ?? undefined,
              targetRole: reviewerRole,
            });
            try {
              const started = await params.runtimeSubagent!.run!({
                sessionKey,
                message: launchParams.message,
                lane: "nested",
                deliver: false,
                idempotencyKey: launchParams.idempotencyKey,
                extraSystemPrompt:
                  "Workflow file audit reviewer.\n" +
                  "Audit only the supplied target file packet and return the required JSON schema.",
              });
              return {
                launched: true,
                runId: started.runId,
                sessionKey,
                error: null,
              };
            } catch (error) {
              return {
                launched: false,
                runId: null,
                sessionKey,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }
        : undefined,
    extractLatestText: extractLatestReadableText,
  });
}
