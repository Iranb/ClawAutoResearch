import { deriveAgentSessionKeyForRole } from "../agent-task-dispatch";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import { evaluateWorkflowHooksForPoint } from "./executor.js";
import { buildWorkflowHookPointContext } from "./point-context.js";
import type { WorkflowHookPoint, WorkflowLine, WorkflowPaperMode } from "./contracts.js";

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

async function readWorkflowHookEnvironment(params: {
  projectRoot: string;
}): Promise<{
  workflowLine: WorkflowLine;
  paperMode: WorkflowPaperMode | null;
}> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      `${params.projectRoot}/PROJECT_MANIFEST.json`
    )) ?? {};
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const workflowLine =
    manifest.workflow_line === "survey" ||
    manifest.paper_type === "survey" ||
    writingContract.paperMode === "survey" ||
    manifest.current_stage === "survey_review"
      ? "survey"
      : "experiment";
  return {
    workflowLine,
    paperMode: writingContract.paperMode,
  };
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
  taskTitle?: string | null;
  handoffIntentId?: string | null;
  targetStage?: string | null;
  transition?: string | null;
  changedPaths?: string[];
  artifactKinds?: string[];
  materializedArtifacts?: Array<{
    contract: string;
    artifactPath: string | null;
    fingerprint: string | null;
    action: "created" | "updated" | "reconciled";
    kind?: string | null;
  }>;
  emittedHookEvents?: Array<{
    hookPoint: WorkflowHookPoint;
    contract: string | null;
    artifactPath: string | null;
  }>;
}) {
  const environment = await readWorkflowHookEnvironment({
    projectRoot: params.projectRoot,
  });
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
      targetRole: params.ownerRole,
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      handoffIntentId: params.handoffIntentId,
      workflowLine: environment.workflowLine,
      paperMode: environment.paperMode,
      targetStage: params.targetStage ?? params.stage,
      transition: params.transition,
      changedPaths: params.changedPaths,
      artifactKinds: params.artifactKinds,
      materializedArtifacts: params.materializedArtifacts,
      emittedHookEvents: params.emittedHookEvents,
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
