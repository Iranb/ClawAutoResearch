import { readWorkflowAnnounceOutboxStore } from "../workflow-execution/runtime-store";
import { recordWorkflowAnnounceEvent } from "../workflow-session-orchestrator.js";
import type { WorkflowHookReviewerAttempt } from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

export type RuntimeSubagentApi = {
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

export async function pollHookReviewerAttempts<
  TResult,
  TAttempt extends WorkflowHookReviewerAttempt<TResult>,
>(params: {
  runtimeSubagent: RuntimeSubagentApi;
  attempts: TAttempt[];
  projectRoot: string;
  projectId: string | null;
  announceIdPrefix: string;
  reviewerLabel: string;
  readAnnounceResult?: (params: {
    entries: Awaited<ReturnType<typeof readWorkflowAnnounceOutboxStore>>["entries"];
    attempt: TAttempt;
  }) => TResult | null;
  extractLatestText: (messages: unknown[]) => string | null;
  parseCompletedResult: (params: {
    latestText: string | null;
    attempt: TAttempt;
  }) => TResult;
  buildFailedResult: (params: { error: string; attempt: TAttempt }) => TResult;
  summarizeCompleted: (params: { attempt: TAttempt; result: TResult }) => string;
  summarizeFailed: (params: { attempt: TAttempt; error: string }) => string;
}) {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: TAttempt[] = [];

  for (const attempt of params.attempts) {
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }

    const announcedResult = params.readAnnounceResult?.({
      entries: announceStore.entries,
      attempt,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: announcedResult,
      });
      continue;
    }

    if (!attempt.runId || !params.runtimeSubagent.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }

    const waited = await params.runtimeSubagent.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const errorText = waited.error ?? `${params.reviewerLabel} run failed`;
      const result = params.buildFailedResult({
        error: errorText,
        attempt,
      });
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: errorText,
        result,
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `${params.announceIdPrefix}:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: params.summarizeFailed({ attempt, error: errorText }),
        payload: {
          reviewerRole: attempt.reviewerRole,
          runId: attempt.runId,
          status: "error",
          error: errorText,
          completedAt: failedAttempt.completedAt,
          result,
        },
      });
      nextAttempts.push(failedAttempt as TAttempt);
      continue;
    }

    const messages = params.runtimeSubagent.getSessionMessages
      ? await params.runtimeSubagent.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = params.extractLatestText(messages.messages);
    const result = params.parseCompletedResult({
      latestText,
      attempt,
    });
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result,
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `${params.announceIdPrefix}:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: params.summarizeCompleted({ attempt, result }),
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        completedAt: completedAttempt.completedAt,
        result,
      },
    });
    nextAttempts.push(completedAttempt as TAttempt);
  }

  return nextAttempts;
}
