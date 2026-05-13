import * as path from "node:path";

import {
  asString,
  normalizeStage,
} from "./workflow-guard-core/coercion";
import { appendWorkflowRuntimeEvent } from "./workflow-runtime-state.js";
import {
  resolveRuntimeOwnership,
  type StageRuntimeState,
} from "./workflow-stage-completion";

export type WorkflowOwnerRuntimeEnsureStatus =
  | "active"
  | "started"
  | "queued"
  | "blocked"
  | "failed";

export type WorkflowOwnerRuntimeDispatchRequest = {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
  summary: string;
  queueKey: string | null;
  now: string;
};

export type WorkflowOwnerRuntimeDispatchResult = {
  started?: boolean;
  queued?: boolean;
  blocked?: boolean;
  failed?: boolean;
  reason?: string | null;
  error?: string | null;
  queueKey?: string | null;
  sessionKey?: string | null;
  runId?: string | null;
};

export type EnsureWorkflowOwnerRuntimeResult = {
  status: WorkflowOwnerRuntimeEnsureStatus;
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
  runtimeState: StageRuntimeState;
  queueKey: string | null;
  sessionKey: string | null;
  runId: string | null;
  reason: string | null;
  error: string | null;
  didDispatch: boolean;
};

export type EnsureWorkflowOwnerRuntimeParams = {
  projectRoot: string;
  projectId?: string | null;
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
  summary?: string | null;
  queueKey?: string | null;
  now?: string;
  staleRuntimeAgeMs?: number;
  writeRuntimeEvent?: boolean;
  dispatch?: (
    request: WorkflowOwnerRuntimeDispatchRequest
  ) => Promise<WorkflowOwnerRuntimeDispatchResult>;
};

function buildOwnerRuntimeQueueKey(params: {
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
}): string {
  return [
    "owner-runtime",
    path.resolve(params.projectRoot),
    params.stage ?? "unknown-stage",
    params.owner ?? "unknown-owner",
    params.nextAction ?? "no-action",
  ].join("::");
}

function dispatchSummary(params: {
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
}): string {
  return `Ensure ${params.owner ?? "workflow owner"} runtime for ${params.stage ?? "current"} stage (${params.nextAction ?? "no action"}).`;
}

async function finalizeOwnerRuntimeResult(params: {
  result: EnsureWorkflowOwnerRuntimeResult;
  projectRoot: string;
  projectId: string | null;
  writeRuntimeEvent: boolean;
}): Promise<EnsureWorkflowOwnerRuntimeResult> {
  if (params.writeRuntimeEvent) {
    await appendWorkflowRuntimeEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      kind: "workflow_owner_runtime_ensure",
      summary: `Workflow owner runtime ensure resolved as ${params.result.status}.`,
      details: {
        status: params.result.status,
        stage: params.result.stage,
        owner: params.result.owner,
        nextAction: params.result.nextAction,
        runtimeState: params.result.runtimeState,
        queueKey: params.result.queueKey,
        sessionKey: params.result.sessionKey,
        runId: params.result.runId,
        reason: params.result.reason,
        error: params.result.error,
        didDispatch: params.result.didDispatch,
      },
    });
  }
  return params.result;
}

function classifyDispatchResult(params: {
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
  queueKey: string | null;
  dispatch: WorkflowOwnerRuntimeDispatchResult;
}): EnsureWorkflowOwnerRuntimeResult {
  const returnedQueueKey = asString(params.dispatch.queueKey);
  const queueKey = returnedQueueKey ?? params.queueKey;
  const sessionKey = asString(params.dispatch.sessionKey);
  const runId = asString(params.dispatch.runId);
  const reason = asString(params.dispatch.reason);
  const error = asString(params.dispatch.error);

  if (params.dispatch.failed === true) {
    return {
      status: "failed",
      stage: params.stage,
      owner: params.owner,
      nextAction: params.nextAction,
      runtimeState: "degraded",
      queueKey,
      sessionKey,
      runId,
      reason: reason ?? "owner_runtime_dispatch_failed",
      error,
      didDispatch: true,
    };
  }
  if (params.dispatch.blocked === true) {
    return {
      status: "blocked",
      stage: params.stage,
      owner: params.owner,
      nextAction: params.nextAction,
      runtimeState: "idle",
      queueKey,
      sessionKey,
      runId,
      reason: reason ?? "owner_runtime_dispatch_blocked",
      error,
      didDispatch: true,
    };
  }
  if (params.dispatch.queued === true) {
    if (!queueKey) {
      return {
        status: "blocked",
        stage: params.stage,
        owner: params.owner,
        nextAction: params.nextAction,
        runtimeState: "degraded",
        queueKey: null,
        sessionKey,
        runId,
        reason: "runtime_queue_missing_key",
        error,
        didDispatch: true,
      };
    }
    return {
      status: "queued",
      stage: params.stage,
      owner: params.owner,
      nextAction: params.nextAction,
      runtimeState: "queued",
      queueKey,
      sessionKey,
      runId,
      reason: reason ?? "owner_runtime_queued",
      error,
      didDispatch: true,
    };
  }
  if (params.dispatch.started === true || sessionKey || runId) {
    if (!sessionKey && !returnedQueueKey) {
      return {
        status: "blocked",
        stage: params.stage,
        owner: params.owner,
        nextAction: params.nextAction,
        runtimeState: "degraded",
        queueKey: null,
        sessionKey: null,
        runId,
        reason: "runtime_dispatch_missing_durable_mapping",
        error,
        didDispatch: true,
      };
    }
    return {
      status: "started",
      stage: params.stage,
      owner: params.owner,
      nextAction: params.nextAction,
      runtimeState: "active",
      queueKey,
      sessionKey,
      runId,
      reason: reason ?? "owner_runtime_started",
      error,
      didDispatch: true,
    };
  }
  return {
    status: "blocked",
    stage: params.stage,
    owner: params.owner,
    nextAction: params.nextAction,
    runtimeState: "idle",
    queueKey,
    sessionKey,
    runId,
    reason: reason ?? "owner_runtime_dispatch_noop",
    error,
    didDispatch: true,
  };
}

export async function ensureWorkflowOwnerRuntime(
  params: EnsureWorkflowOwnerRuntimeParams
): Promise<EnsureWorkflowOwnerRuntimeResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = asString(params.projectId) ?? null;
  const stage = normalizeStage(params.stage);
  const owner = normalizeStage(params.owner);
  const nextAction = asString(params.nextAction);
  const now = params.now ?? new Date().toISOString();
  const writeRuntimeEvent = params.writeRuntimeEvent !== false;

  const finish = (result: EnsureWorkflowOwnerRuntimeResult) =>
    finalizeOwnerRuntimeResult({
      result,
      projectRoot,
      projectId,
      writeRuntimeEvent,
    });

  if (!stage || !owner) {
    return finish({
      status: "blocked",
      stage,
      owner,
      nextAction,
      runtimeState: "idle",
      queueKey: null,
      sessionKey: null,
      runId: null,
      reason: !stage ? "owner_runtime_stage_missing" : "owner_runtime_owner_missing",
      error: null,
      didDispatch: false,
    });
  }

  const runtime = await resolveRuntimeOwnership(projectRoot, {
    stage,
    owner,
    nextAction,
    staleRuntimeAgeMs: params.staleRuntimeAgeMs,
    now,
  });
  if (runtime.runtimeState === "active") {
    return finish({
      status: "active",
      stage,
      owner,
      nextAction,
      runtimeState: "active",
      queueKey: runtime.queueKey ?? null,
      sessionKey: runtime.sessionKey ?? null,
      runId: null,
      reason: "owner_runtime_active",
      error: null,
      didDispatch: false,
    });
  }
  if (runtime.runtimeState === "queued") {
    return finish({
      status: "queued",
      stage,
      owner,
      nextAction,
      runtimeState: "queued",
      queueKey: runtime.queueKey ?? null,
      sessionKey: null,
      runId: null,
      reason: "owner_runtime_queued",
      error: null,
      didDispatch: false,
    });
  }
  if (runtime.runtimeState === "degraded") {
    return finish({
      status: "blocked",
      stage,
      owner,
      nextAction,
      runtimeState: "degraded",
      queueKey: runtime.queueKey ?? null,
      sessionKey: runtime.sessionKey ?? null,
      runId: null,
      reason: runtime.blockingReason ?? "owner_runtime_degraded",
      error: null,
      didDispatch: false,
    });
  }

  if (!params.dispatch) {
    return finish({
      status: "blocked",
      stage,
      owner,
      nextAction,
      runtimeState: "idle",
      queueKey: null,
      sessionKey: null,
      runId: null,
      reason: "owner_runtime_dispatch_unavailable",
      error: null,
      didDispatch: false,
    });
  }

  const queueKey =
    asString(params.queueKey) ??
    buildOwnerRuntimeQueueKey({
      projectRoot,
      stage,
      owner,
      nextAction,
    });
  try {
    const dispatch = await params.dispatch({
      projectRoot,
      projectId,
      stage,
      owner,
      nextAction,
      summary:
        asString(params.summary) ??
        dispatchSummary({
          stage,
          owner,
          nextAction,
        }),
      queueKey,
      now,
    });
    return finish(
      classifyDispatchResult({
        stage,
        owner,
        nextAction,
        queueKey,
        dispatch,
      })
    );
  } catch (error) {
    return finish({
      status: "failed",
      stage,
      owner,
      nextAction,
      runtimeState: "degraded",
      queueKey,
      sessionKey: null,
      runId: null,
      reason: "owner_runtime_dispatch_failed",
      error: error instanceof Error ? error.message : String(error),
      didDispatch: true,
    });
  }
}
