import { createHash } from "node:crypto";
import type { WorkflowRuntimeAnnounceEntry } from "../workflow-execution/runtime-store";
import {
  buildFileAuditPrompt,
  createFileAuditRoundState,
  inspectFileAuditPacketInputs,
  materializeFileAuditPacket,
  parseFileAuditResult,
  writeFileAuditReport,
} from "./file-audit-runner.js";
import { dispatchAggregateHookRevision } from "./revision-dispatch.js";
import { pollHookReviewerAttempts, type RuntimeSubagentApi } from "./runtime-review-loop.js";
import {
  buildDefaultFileAuditHookState,
  getEmptyWorkflowHooksStateStore,
  readWorkflowHooksPolicyForProject,
  readWorkflowHooksStateStore,
  sortHookPolicies,
  summarizeHookExecutionResults,
  upsertWorkflowHookAggregateState,
  writeWorkflowHooksStateStore,
} from "./state.js";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowFileAuditRoundState,
  WorkflowHookEvent,
  WorkflowHookExecutionResult,
  WorkflowHookPoint,
  WorkflowHookPointContext,
  WorkflowHookPointExecutionSummary,
  WorkflowHookReviewerAttempt,
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function matchesAnyGlob(patterns: string[], values: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }
  const normalizedValues = values
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => toPosixPath(entry));
  if (normalizedValues.length === 0) {
    return false;
  }
  const regexes = patterns.map((entry) => globToRegExp(toPosixPath(entry)));
  return normalizedValues.some((value) => regexes.some((regex) => regex.test(value)));
}

function matchesStringFilter(
  allowed: string[] | undefined,
  values: Array<string | null | undefined>
): boolean {
  if (!allowed?.length) {
    return true;
  }
  const normalizedAllowed = new Set(allowed.map((entry) => entry.trim()).filter(Boolean));
  if (normalizedAllowed.size === 0) {
    return true;
  }
  return values.some((entry) => Boolean(entry && normalizedAllowed.has(entry.trim())));
}

function collectMaterializedContracts(context: WorkflowHookPointContext): string[] {
  return [
    ...context.materializedArtifacts.map((entry) => entry.contract),
    ...context.emittedHookEvents
      .map((entry) => entry.contract)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
  ];
}

function buildExecutionFingerprint(params: {
  packetFingerprint: string;
  policy: WorkflowFileAuditHookPolicy;
  context: WorkflowHookPointContext;
}): string {
  return `sha1:${createHash("sha1")
    .update(
      JSON.stringify({
        packetFingerprint: params.packetFingerprint,
        hookId: params.policy.hookId,
        workflowLine: params.context.workflowLine,
        paperMode: params.context.paperMode,
        targetStage: params.context.targetStage ?? params.context.stage,
        transition: params.context.transition,
        targetRole: params.context.targetRole,
        artifactKinds: [...params.context.artifactKinds].sort(),
      })
    )
    .digest("hex")}`;
}

type LaunchHookReviewerRun = (params: {
  hookId: string;
  reviewerRole: string;
  sessionKey: string;
  summary: string;
  message: string;
  idempotencyKey: string;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
}) => Promise<{
  launched: boolean;
  runId: string | null;
  sessionKey: string;
  error: string | null;
}>;

function shouldTriggerFileAuditHook(params: {
  policy: WorkflowFileAuditHookPolicy;
  context: WorkflowHookPointContext;
}): boolean {
  if (!params.policy.enabled) {
    return false;
  }
  if (
    params.policy.stage &&
    params.context.stage &&
    params.policy.stage !== params.context.stage
  ) {
    return false;
  }
  if (params.policy.hookPoint !== params.context.hookPoint) {
    return false;
  }
  if (
    params.policy.appliesWhen?.workflowLines?.length &&
    !matchesStringFilter(params.policy.appliesWhen.workflowLines, [
      params.context.workflowLine,
    ])
  ) {
    return false;
  }
  if (
    params.policy.appliesWhen?.paperModes?.length &&
    !matchesStringFilter(params.policy.appliesWhen.paperModes, [params.context.paperMode])
  ) {
    return false;
  }
  if (
    params.policy.appliesWhen?.stages?.length &&
    !matchesStringFilter(params.policy.appliesWhen.stages, [
      params.context.targetStage,
      params.context.stage,
    ])
  ) {
    return false;
  }
  if (
    params.policy.filters?.workflowLines?.length &&
    !matchesStringFilter(params.policy.filters.workflowLines, [params.context.workflowLine])
  ) {
    return false;
  }
  if (
    params.policy.filters?.paperModes?.length &&
    !matchesStringFilter(params.policy.filters.paperModes, [params.context.paperMode])
  ) {
    return false;
  }
  if (
    params.policy.filters?.targetRoles?.length &&
    !matchesStringFilter(params.policy.filters.targetRoles, [
      params.context.targetRole,
      params.context.ownerRole,
      params.context.actorRole,
    ])
  ) {
    return false;
  }
  if (
    params.policy.filters?.taskIds?.length &&
    !matchesStringFilter(params.policy.filters.taskIds, [params.context.taskId])
  ) {
    return false;
  }
  if (params.policy.filters?.taskPrefixes?.length) {
    const taskId = params.context.taskId ?? "";
    if (
      !params.policy.filters.taskPrefixes.some(
        (prefix) => typeof prefix === "string" && prefix.length > 0 && taskId.startsWith(prefix)
      )
    ) {
      return false;
    }
  }
  if (params.policy.filters?.fileGlobs?.length) {
    if (!matchesAnyGlob(params.policy.filters.fileGlobs, [params.policy.filePath])) {
      return false;
    }
  }
  if (
    params.policy.filters?.materializedContracts?.length &&
    !matchesStringFilter(
      params.policy.filters.materializedContracts,
      collectMaterializedContracts(params.context)
    )
  ) {
    return false;
  }
  if (
    params.policy.filters?.changedPathsAny?.length &&
    !matchesAnyGlob(params.policy.filters.changedPathsAny, params.context.changedPaths)
  ) {
    return false;
  }
  if (params.context.hookPoint === "artifact_materialized") {
    return (
      params.context.materializedArtifacts.length > 0 ||
      params.context.emittedHookEvents.length > 0
    );
  }
  return true;
}

function toAttempt(
  round: WorkflowFileAuditRoundState
): WorkflowHookReviewerAttempt<ReturnType<typeof parseFileAuditResult>> {
  return {
    hookId: round.hookId,
    reviewerRole: round.auditorRole,
    sessionKey: round.sessionKey,
    runId: round.runId,
    status: round.status,
    launchedAt: round.launchedAt,
    completedAt: round.completedAt,
    error: round.error,
    result: round.result,
  };
}

function fromAttempt(
  round: WorkflowFileAuditRoundState,
  attempt: WorkflowHookReviewerAttempt<ReturnType<typeof parseFileAuditResult>>
): WorkflowFileAuditRoundState {
  return {
    ...round,
    status: attempt.status,
    runId: attempt.runId,
    sessionKey: attempt.sessionKey,
    completedAt: attempt.completedAt,
    error: attempt.error,
    result: attempt.result,
  };
}

function extractLatestReadableText(messages: unknown[]): string | null {
  for (const entry of [...messages].reverse()) {
    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const text = JSON.stringify(entry);
    if (text.trim()) {
      return text;
    }
  }
  return null;
}

function getReviewedExecutionFingerprint(params: {
  lastReviewedExecutionFingerprint: string | null;
  lastReviewedPacketFingerprint: string | null;
  lastReviewedFingerprint: string | null;
}): string | null {
  return (
    params.lastReviewedExecutionFingerprint ??
    params.lastReviewedPacketFingerprint ??
    params.lastReviewedFingerprint
  );
}

function getPassedExecutionFingerprint(params: {
  lastPassedExecutionFingerprint: string | null;
  lastPassedPacketFingerprint: string | null;
  lastPassedFingerprint: string | null;
}): string | null {
  return (
    params.lastPassedExecutionFingerprint ??
    params.lastPassedPacketFingerprint ??
    params.lastPassedFingerprint
  );
}

export async function evaluateWorkflowHooksForPoint(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  context: WorkflowHookPointContext;
  requesterSessionKey?: string | null;
  requesterChannel?: string | null;
  launchReviewerRun?: LaunchHookReviewerRun;
  extractLatestText?: (messages: unknown[]) => string | null;
  readAnnounceResult?: (params: {
    entries: WorkflowRuntimeAnnounceEntry[];
    attempt: WorkflowHookReviewerAttempt<ReturnType<typeof parseFileAuditResult>>;
  }) => ReturnType<typeof parseFileAuditResult> | null;
}): Promise<WorkflowHookPointExecutionSummary> {
  const policy = await readWorkflowHooksPolicyForProject(params.context.projectRoot);
  const store =
    (await readWorkflowHooksStateStore(params.context.projectRoot).catch(() => null)) ??
    getEmptyWorkflowHooksStateStore();
  const hooks = sortHookPolicies(
    policy.auditHooks.filter((entry) =>
      shouldTriggerFileAuditHook({
        policy: entry,
        context: params.context,
      })
    )
  );
  if (!policy.enabled || hooks.length === 0) {
    return {
      hookPoint: params.context.hookPoint,
      stage: params.context.stage,
      aggregateVerdict: "pass",
      aggregateStatus: "idle",
      hooksRun: [],
      blockingReason: null,
      aggregateRevisionPacketPath: null,
    };
  }

  const executions: WorkflowHookExecutionResult[] = [];
  const toDispatch: Array<{ policy: WorkflowFileAuditHookPolicy; execution: WorkflowHookExecutionResult }> =
    [];

  for (const hook of hooks) {
    const existingState =
      store.hooks[hook.hookId] ??
      buildDefaultFileAuditHookState({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
      });
    let liveInputs = await inspectFileAuditPacketInputs({
      projectRoot: params.context.projectRoot,
      projectId: params.context.projectId,
      policy: hook,
      context: params.context,
    });
    const currentFingerprint = liveInputs.fileFingerprint;
    const currentPacketFingerprint = liveInputs.packetFingerprint;
    const currentExecutionFingerprint = buildExecutionFingerprint({
      packetFingerprint: currentPacketFingerprint,
      policy: hook,
      context: params.context,
    });
    const lastPassedExecutionFingerprint = getPassedExecutionFingerprint({
      lastPassedExecutionFingerprint: existingState.lastPassedExecutionFingerprint,
      lastPassedPacketFingerprint: existingState.lastPassedPacketFingerprint,
      lastPassedFingerprint: existingState.lastPassedFingerprint,
    });
    const lastReviewedExecutionFingerprint = getReviewedExecutionFingerprint({
      lastReviewedExecutionFingerprint: existingState.lastReviewedExecutionFingerprint,
      lastReviewedPacketFingerprint: existingState.lastReviewedPacketFingerprint,
      lastReviewedFingerprint: existingState.lastReviewedFingerprint,
    });

    if (lastPassedExecutionFingerprint === currentExecutionFingerprint) {
      const nextState = {
        ...existingState,
        status: "passed" as const,
        blockedReason: null,
        escalationReason: null,
        updatedAt: nowIso(),
      };
      store.hooks[hook.hookId] = nextState;
      executions.push({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict: "pass",
        status: "passed",
        pending: false,
        launched: false,
        revisedRequested: false,
        escalated: false,
        fileFingerprint: currentFingerprint,
        result: existingState.activeRound?.result ?? null,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason: null,
      });
      continue;
    }

    if (
      existingState.status === "revise_requested" &&
      lastReviewedExecutionFingerprint === currentExecutionFingerprint
    ) {
      executions.push({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict: hook.blockingMode === "warn_only" ? "pass" : existingState.lastVerdict,
        status: existingState.status,
        pending: false,
        launched: false,
        revisedRequested: hook.blockingMode !== "warn_only",
        escalated: false,
        fileFingerprint: currentFingerprint,
        result: existingState.activeRound?.result ?? null,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason:
          hook.blockingMode === "warn_only"
            ? null
            : existingState.blockedReason ??
              "Workflow hook is waiting for the target file to change before re-audit.",
      });
      continue;
    }

    if (
      existingState.roundsStarted >= hook.maxRounds ||
      existingState.consecutiveUnchangedRounds >= hook.maxUnchangedRounds
    ) {
      const nextState = {
        ...existingState,
        status: "escalated" as const,
        escalationReason:
          existingState.escalationReason ??
          "Workflow hook exceeded the configured retry budget.",
        updatedAt: nowIso(),
      };
      store.hooks[hook.hookId] = nextState;
      executions.push({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict: hook.blockingMode === "warn_only" ? "pass" : "block",
        status: nextState.status,
        pending: false,
        launched: false,
        revisedRequested: false,
        escalated: hook.blockingMode !== "warn_only",
        fileFingerprint: currentFingerprint,
        result: existingState.activeRound?.result ?? null,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason:
          hook.blockingMode === "warn_only" ? null : nextState.escalationReason,
      });
      continue;
    }

    if (existingState.status === "auditing" && existingState.activeRound) {
      const activeRound = existingState.activeRound;
      if (
        activeRound.executionFingerprint &&
        activeRound.executionFingerprint !== currentExecutionFingerprint
      ) {
        const nextState = {
          ...existingState,
          activeRound: null,
          status: "idle" as const,
          blockedReason:
            "Workflow hook inputs changed while the review was running; restarting the audit on the latest packet.",
          updatedAt: nowIso(),
        };
        store.hooks[hook.hookId] = nextState;
      } else {
      const attempts = await pollHookReviewerAttempts({
        runtimeSubagent: params.runtimeSubagent ?? {},
        attempts: [toAttempt(activeRound)],
        projectRoot: params.context.projectRoot,
        projectId: params.context.projectId,
        announceIdPrefix: `hook-audit:${hook.hookId}`,
        reviewerLabel: `workflow hook ${hook.hookId}`,
        readAnnounceResult: params.readAnnounceResult
          ? ({ entries, attempt }) =>
              params.readAnnounceResult?.({ entries, attempt }) ?? null
          : undefined,
        extractLatestText: params.extractLatestText ?? extractLatestReadableText,
        parseCompletedResult: ({ latestText, attempt }) =>
          parseFileAuditResult({
            rawText:
              latestText ??
              JSON.stringify({
                verdict: "block",
                summary: "No readable response was found in the reviewer transcript.",
                violations: [
                  {
                    rule: "missing_response",
                    severity: "high",
                    location: null,
                    message: "Reviewer returned no readable response.",
                  },
                ],
                requiredFixes: [],
                reviewedArtifacts: [hook.filePath],
              }),
            reviewerRole: attempt.reviewerRole,
            filePath: hook.filePath,
            fileFingerprint: activeRound.fileFingerprint,
            runId: attempt.runId,
          }),
        buildFailedResult: ({ error, attempt }) =>
          parseFileAuditResult({
            rawText: JSON.stringify({
              verdict: "block",
              summary: "File audit reviewer run failed before returning a valid response.",
              violations: [
                {
                  rule: "review_run_failed",
                  severity: "high",
                  location: null,
                  message: error,
                },
              ],
              requiredFixes: [],
              reviewedArtifacts: [hook.filePath],
            }),
            reviewerRole: attempt.reviewerRole,
            filePath: hook.filePath,
            fileFingerprint: activeRound.fileFingerprint,
            runId: attempt.runId,
          }),
        summarizeCompleted: ({ attempt, result }) =>
          `Workflow hook ${hook.hookId} reviewer ${attempt.reviewerRole} completed with ${result.verdict}.`,
        summarizeFailed: ({ attempt, error }) =>
          `Workflow hook ${hook.hookId} reviewer ${attempt.reviewerRole} failed: ${error}`,
      });
      const updatedAttempt = attempts[0];
      const nextRound = fromAttempt(activeRound, updatedAttempt);
      if (nextRound.result) {
        nextRound.result = {
          ...nextRound.result,
          fileFingerprint: activeRound.fileFingerprint,
          packetFingerprint: activeRound.packetFingerprint,
        };
        await writeFileAuditReport({
          projectRoot: params.context.projectRoot,
          round: nextRound,
          hookId: hook.hookId,
          result: nextRound.result,
        });
      }
      const unchanged =
        activeRound.executionFingerprint != null &&
        lastReviewedExecutionFingerprint != null &&
        activeRound.executionFingerprint === lastReviewedExecutionFingerprint;
      const nextState = {
        ...existingState,
        activeRound: null,
        lastReviewedFingerprint: activeRound.fileFingerprint,
        lastReviewedPacketFingerprint: activeRound.packetFingerprint,
        lastReviewedExecutionFingerprint: activeRound.executionFingerprint ?? null,
        lastVerdict: nextRound.result?.verdict ?? "block",
        consecutiveUnchangedRounds: unchanged
          ? existingState.consecutiveUnchangedRounds + 1
          : 0,
        blockedReason:
          nextRound.result?.verdict === "pass"
            ? null
            : nextRound.result?.summary ?? "Workflow hook requested revision.",
        status:
          nextRound.result?.verdict === "pass"
            ? ("passed" as const)
            : nextRound.result?.verdict === "revise"
              ? ("revise_requested" as const)
              : ("failed" as const),
        updatedAt: nowIso(),
        lastPassedFingerprint:
          nextRound.result?.verdict === "pass"
            ? activeRound.fileFingerprint
            : existingState.lastPassedFingerprint,
        lastPassedPacketFingerprint:
          nextRound.result?.verdict === "pass"
            ? activeRound.packetFingerprint
            : existingState.lastPassedPacketFingerprint,
        lastPassedExecutionFingerprint:
          nextRound.result?.verdict === "pass"
            ? activeRound.executionFingerprint ?? null
            : existingState.lastPassedExecutionFingerprint ?? null,
      };
      store.hooks[hook.hookId] = nextState;
      const execution: WorkflowHookExecutionResult = {
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict:
          hook.blockingMode === "warn_only"
            ? "pass"
            : (nextRound.result?.verdict ?? "block"),
        status: nextState.status,
        pending: false,
        launched: false,
        revisedRequested:
          hook.blockingMode !== "warn_only" &&
          nextRound.result?.verdict !== "pass",
        escalated: false,
        fileFingerprint: activeRound.fileFingerprint,
        result: nextRound.result,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason:
          hook.blockingMode === "warn_only" ? null : nextState.blockedReason,
      };
      if (
        hook.blockingMode !== "warn_only" &&
        nextRound.result &&
        nextRound.result.verdict !== "pass"
      ) {
        toDispatch.push({ policy: hook, execution });
      }
      executions.push(execution);
      continue;
      }
    }

    if (!params.runtimeSubagent || !params.launchReviewerRun) {
      executions.push({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict: hook.blockingMode === "warn_only" ? "pass" : "block",
        status: "failed",
        pending: false,
        launched: false,
        revisedRequested: false,
        escalated: hook.blockingMode !== "warn_only",
        fileFingerprint: currentFingerprint,
        result: null,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason:
          hook.blockingMode === "warn_only"
            ? null
            : "Workflow runtime subagent is unavailable, so hook review cannot run.",
      });
      continue;
    }

    const roundNumber = existingState.roundsStarted + 1;
    const packet = await materializeFileAuditPacket({
      projectRoot: params.context.projectRoot,
      projectId: params.context.projectId,
      policy: hook,
      context: params.context,
      roundNumber,
    });
    const launch = await params.launchReviewerRun({
      hookId: hook.hookId,
      reviewerRole: hook.auditorRole,
      sessionKey: `agent:${hook.auditorRole}:main`,
      summary: `Run workflow file audit hook ${hook.hookId}.`,
      message: buildFileAuditPrompt({
        projectRoot: params.context.projectRoot,
        projectId: params.context.projectId,
        policy: hook,
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
      }),
      idempotencyKey: `workflow-hook:${hook.hookId}:${packet.fileFingerprint ?? "missing"}:${hook.hookPoint}`,
      projectRoot: params.context.projectRoot,
      projectId: params.context.projectId,
      stage: params.context.stage,
    });
    if (!launch.launched || !launch.sessionKey) {
      executions.push({
        hookId: hook.hookId,
        hookPoint: hook.hookPoint,
        stage: hook.stage,
        verdict: hook.blockingMode === "warn_only" ? "pass" : "block",
        status: "failed",
        pending: false,
        launched: false,
        revisedRequested: false,
        escalated: hook.blockingMode !== "warn_only",
        fileFingerprint: packet.fileFingerprint,
        result: null,
        revisionDispatch: existingState.lastRevisionDispatch,
        blockingReason:
          hook.blockingMode === "warn_only"
            ? null
            : launch.error ?? "Workflow hook reviewer could not be launched.",
      });
      continue;
    }
    const nextRound = createFileAuditRoundState({
      policy: hook,
      stage: params.context.stage,
      hookPoint: params.context.hookPoint,
      packetPath: packet.packetPath,
      packetJsonPath: packet.packetJsonPath,
      reportPath: packet.reportPath,
      reportMarkdownPath: packet.reportMarkdownPath,
      fileFingerprint: packet.fileFingerprint,
      packetFingerprint: packet.packetFingerprint,
      sessionKey: launch.sessionKey,
      runId: launch.runId,
    });
    nextRound.executionFingerprint = currentExecutionFingerprint;
    store.hooks[hook.hookId] = {
      ...existingState,
      roundsStarted: roundNumber,
      activeRound: nextRound,
      status: "auditing",
      blockedReason: "Workflow hook review is currently running.",
      updatedAt: nowIso(),
    };
    executions.push({
      hookId: hook.hookId,
      hookPoint: hook.hookPoint,
      stage: hook.stage,
      verdict: null,
      status: "auditing",
      pending: true,
      launched: true,
      revisedRequested: false,
      escalated: false,
      fileFingerprint: packet.fileFingerprint,
      result: null,
      revisionDispatch: existingState.lastRevisionDispatch,
      blockingReason:
        hook.blockingMode === "warn_only" ? null : "Workflow hook review is running.",
    });
  }

  const newDispatches =
    toDispatch.length > 0
      ? await dispatchAggregateHookRevision({
          runtimeSubagent: params.runtimeSubagent,
          requesterSessionKey: params.requesterSessionKey,
          requesterChannel: params.requesterChannel,
          projectRoot: params.context.projectRoot,
          projectId: params.context.projectId,
          stage: params.context.stage,
          hookPoint: params.context.hookPoint,
          executions: toDispatch,
        })
      : [];
  if (newDispatches.length > 0) {
    for (const dispatchState of newDispatches) {
      for (const item of toDispatch.filter(
        (entry) =>
          (entry.policy.reviseOwnerRole ?? entry.policy.targetRole) === dispatchState.targetRole
      )) {
        const state = store.hooks[item.policy.hookId];
        if (!state) {
          continue;
        }
        state.lastRevisionDispatch = dispatchState;
        state.updatedAt = nowIso();
      }
      for (const execution of executions) {
        if (
          (toDispatch.find((entry) => entry.execution.hookId === execution.hookId)?.policy
            .reviseOwnerRole ??
            toDispatch.find((entry) => entry.execution.hookId === execution.hookId)?.policy
              .targetRole) === dispatchState.targetRole
        ) {
          execution.revisionDispatch = dispatchState;
        }
      }
    }
  }

  const aggregate = summarizeHookExecutionResults(executions);
  const nextStore = upsertWorkflowHookAggregateState({
    store,
    hookPoint: params.context.hookPoint,
    stage: params.context.stage,
    aggregateState: {
      aggregateStatus: aggregate.aggregateStatus,
      aggregateVerdict: aggregate.aggregateVerdict,
      aggregateRevisionPacketPath: aggregate.aggregateRevisionPacketPath,
      updatedAt: nowIso(),
    },
  });
  await writeWorkflowHooksStateStore(params.context.projectRoot, nextStore);

  return {
    hookPoint: params.context.hookPoint,
    stage: params.context.stage,
    aggregateVerdict: aggregate.aggregateVerdict,
    aggregateStatus: aggregate.aggregateStatus,
    hooksRun: executions,
    blockingReason: aggregate.blockingReason,
    aggregateRevisionPacketPath: aggregate.aggregateRevisionPacketPath,
  };
}

export function buildHookEventsForMaterializedContracts(params: {
  hookPoint: WorkflowHookPoint;
  contracts: string[];
}): WorkflowHookEvent[] {
  return params.contracts.map((contract) => ({
    hookPoint: params.hookPoint,
    contract,
    artifactPath: null,
  }));
}
