import type {
  WorkflowHookExecutionResult,
  WorkflowHookPoint,
  WorkflowHookPointExecutionSummary,
  WorkflowHookPointAggregateVerdict,
  WorkflowHookRunStatus,
} from "./contracts.js";
import {
  buildDefaultFileAuditHookState,
  getEmptyWorkflowHooksStateStore,
  readWorkflowHooksStateStore,
  summarizeHookExecutionResults,
  upsertWorkflowHookAggregateState,
  writeWorkflowHooksStateStore,
} from "./state.js";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStage(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildRevisionDispatch(packetPath: string | null) {
  if (!packetPath) {
    return null;
  }
  return {
    runId: null,
    sessionKey: null,
    dispatchedAt: nowIso(),
    targetRole: null,
    aggregateRevisionPacketPath: packetPath,
  };
}

export function buildBuiltinCodeReviewHookId(stage: string | null = "code"): string {
  return `builtin.code-innovation-review:${normalizeStage(stage) ?? "global"}`;
}

export function buildBuiltinSubmitReadinessHookId(stage: string | null = "submit"): string {
  return `builtin.submit-readiness:${normalizeStage(stage) ?? "global"}`;
}

export function buildBuiltinAutoModeRiskHookId(stage: string | null): string {
  return `builtin.auto-mode-risk:${normalizeStage(stage) ?? "global"}`;
}

export function buildBuiltinReviewRoundHookId(params: {
  workflowLine?: "experiment" | "survey" | null;
  stage?: string | null;
}): string {
  return `builtin.review-round:${params.workflowLine ?? "experiment"}:${normalizeStage(params.stage) ?? "global"}`;
}

export function isBuiltinWorkflowHookId(hookId: string): boolean {
  return hookId.startsWith("builtin.");
}

export async function writeBuiltinWorkflowHookState(params: {
  projectRoot: string;
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  status: WorkflowHookRunStatus;
  verdict: WorkflowHookPointAggregateVerdict;
  blockingReason?: string | null;
  aggregateRevisionPacketPath?: string | null;
}): Promise<void> {
  const store =
    (await readWorkflowHooksStateStore(params.projectRoot).catch(() => null)) ??
    getEmptyWorkflowHooksStateStore();
  const existing =
    store.hooks[params.hookId] ??
    buildDefaultFileAuditHookState({
      hookId: params.hookId,
      hookPoint: params.hookPoint,
      stage: params.stage,
    });
  store.hooks[params.hookId] = {
    ...existing,
    stage: params.stage,
    hookPoint: params.hookPoint,
    status: params.status,
    activeRound: null,
    lastVerdict: params.verdict,
    blockedReason: params.blockingReason ?? null,
    escalationReason:
      params.status === "escalated" ? params.blockingReason ?? "builtin_hook_escalated" : null,
    lastRevisionDispatch: buildRevisionDispatch(params.aggregateRevisionPacketPath ?? null),
    updatedAt: nowIso(),
  };
  const builtinExecutions = Object.values(store.hooks)
    .filter(
      (state) =>
        isBuiltinWorkflowHookId(state.hookId) &&
        state.hookPoint === params.hookPoint &&
        normalizeStage(state.stage) === normalizeStage(params.stage)
    )
    .map((state) => ({
      hookId: state.hookId,
      hookPoint: state.hookPoint,
      stage: state.stage,
      verdict: state.lastVerdict,
      status: state.status,
      pending: state.status === "auditing",
      launched: false,
      revisedRequested: state.status === "revise_requested" || state.lastVerdict === "revise",
      escalated: state.status === "escalated",
      fileFingerprint: null,
      result: null,
      revisionDispatch: state.lastRevisionDispatch,
      blockingReason: state.blockedReason,
    }))
    .filter(
      (entry) =>
        entry.status !== "idle" ||
        entry.verdict != null ||
        entry.blockingReason != null ||
        entry.revisionDispatch != null
    );
  const aggregate = summarizeHookExecutionResults(builtinExecutions);
  const nextStore = upsertWorkflowHookAggregateState({
    store,
    hookPoint: params.hookPoint,
    stage: params.stage,
    aggregateState: {
      aggregateStatus: aggregate.aggregateStatus,
      aggregateVerdict: aggregate.aggregateVerdict,
      aggregateRevisionPacketPath: aggregate.aggregateRevisionPacketPath,
      updatedAt: nowIso(),
    },
  });
  await writeWorkflowHooksStateStore(params.projectRoot, nextStore);
}

export async function readBuiltinWorkflowHookExecutionsForPoint(params: {
  projectRoot: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
}): Promise<WorkflowHookExecutionResult[]> {
  const store =
    (await readWorkflowHooksStateStore(params.projectRoot).catch(() => null)) ??
    getEmptyWorkflowHooksStateStore();
  const stage = normalizeStage(params.stage);
  return Object.values(store.hooks)
    .filter(
      (state) =>
        isBuiltinWorkflowHookId(state.hookId) &&
        state.hookPoint === params.hookPoint &&
        normalizeStage(state.stage) === stage
    )
    .map((state) => ({
      hookId: state.hookId,
      hookPoint: state.hookPoint,
      stage: state.stage,
      verdict: state.lastVerdict,
      status: state.status,
      pending: state.status === "auditing",
      launched: false,
      revisedRequested: state.status === "revise_requested" || state.lastVerdict === "revise",
      escalated: state.status === "escalated",
      fileFingerprint: null,
      result: null,
      revisionDispatch: state.lastRevisionDispatch,
      blockingReason: state.blockedReason,
    }))
    .filter(
      (entry) =>
        entry.status !== "idle" ||
        entry.verdict != null ||
        entry.blockingReason != null ||
        entry.revisionDispatch != null
    );
}

export async function mergeBuiltinWorkflowHooksIntoSummary(params: {
  projectRoot: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  summary: WorkflowHookPointExecutionSummary;
}): Promise<WorkflowHookPointExecutionSummary> {
  const builtinExecutions = await readBuiltinWorkflowHookExecutionsForPoint({
    projectRoot: params.projectRoot,
    hookPoint: params.hookPoint,
    stage: params.stage,
  });
  if (builtinExecutions.length === 0) {
    return params.summary;
  }
  const hooksRun = [...params.summary.hooksRun, ...builtinExecutions].sort((left, right) =>
    left.hookId.localeCompare(right.hookId)
  );
  const aggregate = summarizeHookExecutionResults(hooksRun);
  const store =
    (await readWorkflowHooksStateStore(params.projectRoot).catch(() => null)) ??
    getEmptyWorkflowHooksStateStore();
  const nextStore = upsertWorkflowHookAggregateState({
    store,
    hookPoint: params.hookPoint,
    stage: params.stage,
    aggregateState: {
      aggregateStatus: aggregate.aggregateStatus,
      aggregateVerdict: aggregate.aggregateVerdict,
      aggregateRevisionPacketPath: aggregate.aggregateRevisionPacketPath,
      updatedAt: nowIso(),
    },
  });
  await writeWorkflowHooksStateStore(params.projectRoot, nextStore);
  return {
    ...params.summary,
    hooksRun,
    aggregateVerdict: aggregate.aggregateVerdict,
    aggregateStatus: aggregate.aggregateStatus,
    blockingReason: aggregate.blockingReason,
    aggregateRevisionPacketPath: aggregate.aggregateRevisionPacketPath,
  };
}

export async function syncBuiltinAutoCodeReviewHook(params: {
  projectRoot: string;
  stage: string | null;
  attempt: {
    reason: string;
    status: string | null;
    approved: boolean;
  };
}): Promise<void> {
  let status: WorkflowHookRunStatus = "idle";
  let verdict: WorkflowHookPointAggregateVerdict = null;
  let blockingReason: string | null = null;

  if (params.attempt.reason === "bundle_incomplete") {
    status = "failed";
    verdict = "block";
    blockingReason = "Code review bundle is incomplete and cannot be handed off yet.";
  } else if (params.attempt.approved || params.attempt.reason === "already_approved") {
    status = "passed";
    verdict = "pass";
  } else if (
    params.attempt.reason === "already_rejected" ||
    params.attempt.status === "rejected" ||
    params.attempt.reason === "launch_failed"
  ) {
    status = "failed";
    verdict = "block";
    blockingReason = "Code innovation review rejected the current code-stage bundle.";
  } else if (
    params.attempt.reason === "started" ||
    params.attempt.reason === "reviewing" ||
    params.attempt.status === "reviewing"
  ) {
    status = "auditing";
    blockingReason = "Code innovation review is still running.";
  } else if (params.attempt.reason === "no_runtime_subagent") {
    status = "auditing";
    blockingReason = "Code innovation review requires a runtime reviewer session.";
  }

  await writeBuiltinWorkflowHookState({
    projectRoot: params.projectRoot,
    hookId: buildBuiltinCodeReviewHookId(params.stage),
    hookPoint: "before_stage_handoff",
    stage: params.stage,
    status,
    verdict,
    blockingReason,
  });
}

export async function syncBuiltinSubmitReadinessHook(params: {
  projectRoot: string;
  stage: string | null;
  attempt: {
    reason: string;
    status: string | null;
    approved: boolean;
  };
}): Promise<void> {
  let status: WorkflowHookRunStatus = "idle";
  let verdict: WorkflowHookPointAggregateVerdict = null;
  let blockingReason: string | null = null;

  if (params.attempt.approved || params.attempt.reason === "already_approved") {
    status = "passed";
    verdict = "pass";
  } else if (params.attempt.reason === "already_rejected") {
    status = "failed";
    verdict = "block";
    blockingReason = "Submit readiness thresholds are not satisfied.";
  } else if (params.attempt.reason === "manual_confirmation_required") {
    status = "revise_requested";
    verdict = "revise";
    blockingReason = "Submit transition still requires manual confirmation.";
  } else if (
    params.attempt.reason === "started" ||
    params.attempt.reason === "reviewing" ||
    params.attempt.status === "reviewing"
  ) {
    status = "auditing";
    blockingReason = "Submit readiness review is still running.";
  } else if (params.attempt.reason === "no_runtime_subagent") {
    status = "auditing";
    blockingReason = "Submit readiness review requires a runtime reviewer session.";
  }

  await writeBuiltinWorkflowHookState({
    projectRoot: params.projectRoot,
    hookId: buildBuiltinSubmitReadinessHookId(params.stage),
    hookPoint: "before_stage_handoff",
    stage: params.stage,
    status,
    verdict,
    blockingReason,
  });
}

export async function syncBuiltinAutoModeRiskHook(params: {
  projectRoot: string;
  stage: string | null;
  attempt: {
    reason: string;
    status: string | null;
    summary: string | null;
    blockers: string[];
  };
}): Promise<void> {
  let status: WorkflowHookRunStatus = "idle";
  let verdict: WorkflowHookPointAggregateVerdict = null;
  let blockingReason: string | null = null;

  if (params.attempt.reason === "resolved" || params.attempt.status === "resolved") {
    status = "passed";
    verdict = "pass";
  } else if (
    params.attempt.reason === "started" ||
    params.attempt.reason === "reviewing" ||
    params.attempt.status === "reviewing"
  ) {
    status = "auditing";
    blockingReason = params.attempt.summary ?? "Auto-mode risk discussion is still running.";
  } else if (params.attempt.reason === "round_limit_reached" || params.attempt.status === "blocked") {
    status = "failed";
    verdict = "block";
    blockingReason =
      params.attempt.blockers[0] ??
      params.attempt.summary ??
      "Auto-mode risk discussion still reports blocking issues.";
  } else if (params.attempt.status === "needs_changes") {
    status = "revise_requested";
    verdict = "revise";
    blockingReason =
      params.attempt.blockers[0] ??
      params.attempt.summary ??
      "Auto-mode risk discussion requested another mitigation pass.";
  } else if (params.attempt.reason === "no_runtime_subagent") {
    status = "auditing";
    blockingReason = "Auto-mode risk discussion requires a runtime reviewer session.";
  }

  await writeBuiltinWorkflowHookState({
    projectRoot: params.projectRoot,
    hookId: buildBuiltinAutoModeRiskHookId(params.stage),
    hookPoint: "before_stage_handoff",
    stage: params.stage,
    status,
    verdict,
    blockingReason,
  });
}

export async function syncBuiltinReviewRoundHook(params: {
  projectRoot: string;
  workflowLine?: "experiment" | "survey" | null;
  stage: string | null;
  aggregateVerdict: "pass" | "revise" | "block";
  summary: string | null;
}): Promise<void> {
  await writeBuiltinWorkflowHookState({
    projectRoot: params.projectRoot,
    hookId: buildBuiltinReviewRoundHookId({
      workflowLine: params.workflowLine,
      stage: params.stage,
    }),
    hookPoint: "before_stage_handoff",
    stage: params.stage,
    status:
      params.aggregateVerdict === "pass"
        ? "passed"
        : params.aggregateVerdict === "revise"
          ? "revise_requested"
          : "failed",
    verdict: params.aggregateVerdict,
    blockingReason:
      params.aggregateVerdict === "pass"
        ? null
        : params.summary ?? "Workflow review round did not pass.",
  });
}
