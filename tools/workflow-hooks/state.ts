import path from "node:path";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowFileAuditHookState,
  WorkflowFileAuditResult,
  WorkflowFileAuditRoundState,
  WorkflowHookEvent,
  WorkflowHookExecutionResult,
  WorkflowHookPoint,
  WorkflowHookPointAggregateState,
  WorkflowHookPointAggregateVerdict,
  WorkflowHooksPolicy,
  WorkflowHooksStateStore,
  WorkflowHookRevisionDispatchState,
  WorkflowMaterializedArtifact,
} from "./contracts.js";
import {
  WORKFLOW_HOOK_BLOCKING_MODES,
  WORKFLOW_HOOK_POINTS,
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function getWorkflowHooksStatePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json");
}

function normalizeHookPoint(value: unknown): WorkflowHookPoint {
  const normalized = normalizeStage(value);
  return (WORKFLOW_HOOK_POINTS as readonly string[]).includes(normalized ?? "")
    ? (normalized as WorkflowHookPoint)
    : "before_stage_handoff";
}

function normalizeBlockingMode(value: unknown): WorkflowFileAuditHookPolicy["blockingMode"] {
  const normalized = normalizeStage(value);
  return (WORKFLOW_HOOK_BLOCKING_MODES as readonly string[]).includes(normalized ?? "")
    ? (normalized as WorkflowFileAuditHookPolicy["blockingMode"])
    : "block_stage";
}

function normalizeOptionalVerdict(
  value: unknown
): WorkflowHookPointAggregateVerdict {
  const normalized = normalizeStage(value);
  if (normalized === "pass" || normalized === "revise" || normalized === "block") {
    return normalized;
  }
  return null;
}

function normalizeOptionalResult(value: unknown): WorkflowFileAuditResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    verdict: normalizeOptionalVerdict(record.verdict) ?? "block",
    summary: pickString(record, ["summary"]),
    violations: Array.isArray(record.violations)
      ? record.violations
          .map((entry) => asRecord(entry))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .map((entry) => ({
            rule: pickString(entry, ["rule"]) ?? "unclassified",
            severity:
              (pickString(entry, ["severity"]) as "low" | "medium" | "high" | "critical" | null) ??
              "high",
            location: pickString(entry, ["location"]),
            message: pickString(entry, ["message"]) ?? "Audit violation.",
          }))
      : [],
    requiredFixes: asStringArray(record.requiredFixes ?? record.required_fixes),
    reviewedArtifacts: asStringArray(
      record.reviewedArtifacts ?? record.reviewed_artifacts
    ),
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : null,
    runId: pickString(record, ["runId", "run_id"]),
    rawText: pickString(record, ["rawText", "raw_text"]),
    reviewerRole: pickString(record, ["reviewerRole", "reviewer_role"]) ?? "reviewer",
    filePath: pickString(record, ["filePath", "file_path"]) ?? "",
    fileFingerprint: pickString(record, ["fileFingerprint", "file_fingerprint"]),
    createdAt: pickString(record, ["createdAt", "created_at"]) ?? nowIso(),
  };
}

function normalizeRoundState(value: unknown): WorkflowFileAuditRoundState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    roundId: pickString(record, ["roundId", "round_id"]) ?? "",
    status:
      normalizeStage(record.status) === "completed" || normalizeStage(record.status) === "error"
        ? (normalizeStage(record.status) as "completed" | "error")
        : "pending",
    hookId: pickString(record, ["hookId", "hook_id"]) ?? "",
    hookPoint: normalizeHookPoint(record.hookPoint ?? record.hook_point),
    stage: normalizeStage(record.stage),
    auditorRole: pickString(record, ["auditorRole", "auditor_role"]) ?? "reviewer",
    targetRole: pickString(record, ["targetRole", "target_role"]),
    filePath: pickString(record, ["filePath", "file_path"]) ?? "",
    fileFingerprint: pickString(record, ["fileFingerprint", "file_fingerprint"]),
    packetPath: pickString(record, ["packetPath", "packet_path"]) ?? "",
    packetJsonPath: pickString(record, ["packetJsonPath", "packet_json_path"]) ?? "",
    reportPath: pickString(record, ["reportPath", "report_path"]) ?? "",
    reportMarkdownPath:
      pickString(record, ["reportMarkdownPath", "report_markdown_path"]) ?? "",
    runId: pickString(record, ["runId", "run_id"]),
    sessionKey: pickString(record, ["sessionKey", "session_key"]) ?? "",
    launchedAt: pickString(record, ["launchedAt", "launched_at"]) ?? nowIso(),
    completedAt: pickString(record, ["completedAt", "completed_at"]),
    result: normalizeOptionalResult(record.result),
    error: pickString(record, ["error"]),
  };
}

function normalizeRevisionDispatch(
  value: unknown
): WorkflowHookRevisionDispatchState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    runId: pickString(record, ["runId", "run_id"]),
    sessionKey: pickString(record, ["sessionKey", "session_key"]),
    dispatchedAt: pickString(record, ["dispatchedAt", "dispatched_at"]) ?? nowIso(),
    targetRole: pickString(record, ["targetRole", "target_role"]),
    aggregateRevisionPacketPath: pickString(record, [
      "aggregateRevisionPacketPath",
      "aggregate_revision_packet_path",
    ]),
  };
}

export function normalizeFileAuditHookPolicy(value: unknown): WorkflowFileAuditHookPolicy | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const hookId =
    pickString(record, ["hookId", "hook_id", "checkpointId", "checkpoint_id"]) ?? null;
  const filePath = pickString(record, ["filePath", "file_path"]);
  const requirementPrompt = pickString(record, [
    "requirementPrompt",
    "requirement_prompt",
  ]);
  if (!hookId || !filePath || !requirementPrompt) {
    return null;
  }
  return {
    hookId,
    hookType: "file_audit",
    enabled: pickBoolean(record, ["enabled"]) ?? true,
    stage: normalizeStage(record.stage),
    hookPoint: normalizeHookPoint(
      record.hookPoint ?? record.hook_point ?? record.trigger
    ),
    order: Math.max(0, Math.floor(pickNumber(record, ["order"]) ?? 100)),
    parallelGroup: pickString(record, ["parallelGroup", "parallel_group"]),
    targetRole: pickString(record, ["targetRole", "target_role"]),
    auditorRole:
      pickString(record, ["auditorRole", "auditor_role"]) ?? "reviewer",
    filePath,
    requirementPrompt,
    supportingArtifacts: asStringArray(
      record.supportingArtifacts ?? record.supporting_artifacts
    ),
    blockingMode: normalizeBlockingMode(
      record.blockingMode ?? record.blocking_mode
    ),
    maxRounds: Math.max(1, Math.floor(pickNumber(record, ["maxRounds", "max_rounds"]) ?? 3)),
    maxUnchangedRounds: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["maxUnchangedRounds", "max_unchanged_rounds"]) ?? 2
      )
    ),
    reviseOwnerRole:
      pickString(record, ["reviseOwnerRole", "revise_owner_role"]) ??
      pickString(record, ["targetRole", "target_role"]),
    reviseCommand: pickString(record, ["reviseCommand", "revise_command"]),
    reportDir: pickString(record, ["reportDir", "report_dir"]),
  };
}

export function normalizeWorkflowHooksPolicy(value: unknown): WorkflowHooksPolicy {
  const record = asRecord(value) ?? {};
  const workflowHooks = asRecord(record.workflow_hooks ?? record.workflowHooks ?? value) ?? {};
  const workflowAudit = asRecord(record.workflow_audit ?? record.workflowAudit) ?? {};
  const auditHooks = Array.isArray(workflowHooks.audit_hooks)
    ? workflowHooks.audit_hooks
    : Array.isArray(workflowHooks.auditHooks)
      ? workflowHooks.auditHooks
      : Array.isArray(workflowAudit.checkpoints)
        ? workflowAudit.checkpoints
        : Array.isArray(workflowAudit.audit_hooks)
          ? workflowAudit.audit_hooks
          : [];
  const normalizedHooks = auditHooks
    .map((entry) => normalizeFileAuditHookPolicy(entry))
    .filter((entry): entry is WorkflowFileAuditHookPolicy => Boolean(entry))
    .sort((left, right) => {
      if (left.hookPoint !== right.hookPoint) {
        return left.hookPoint.localeCompare(right.hookPoint);
      }
      if ((left.stage ?? "") !== (right.stage ?? "")) {
        return (left.stage ?? "").localeCompare(right.stage ?? "");
      }
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.hookId.localeCompare(right.hookId);
    });
  return {
    enabled:
      pickBoolean(workflowHooks, ["enabled"]) ??
      pickBoolean(workflowAudit, ["enabled"]) ??
      normalizedHooks.length > 0,
    auditHooks: normalizedHooks,
  };
}

export function serializeFileAuditHookPolicy(
  policy: WorkflowFileAuditHookPolicy
): Record<string, unknown> {
  return {
    hook_id: policy.hookId,
    hook_type: policy.hookType,
    enabled: policy.enabled,
    stage: policy.stage,
    hook_point: policy.hookPoint,
    order: policy.order,
    parallel_group: policy.parallelGroup,
    target_role: policy.targetRole,
    auditor_role: policy.auditorRole,
    file_path: policy.filePath,
    requirement_prompt: policy.requirementPrompt,
    supporting_artifacts: policy.supportingArtifacts,
    blocking_mode: policy.blockingMode,
    max_rounds: policy.maxRounds,
    max_unchanged_rounds: policy.maxUnchangedRounds,
    revise_owner_role: policy.reviseOwnerRole,
    revise_command: policy.reviseCommand,
    report_dir: policy.reportDir,
  };
}

export function serializeWorkflowHooksPolicy(
  policy: WorkflowHooksPolicy
): Record<string, unknown> {
  return {
    enabled: policy.enabled,
    audit_hooks: policy.auditHooks.map((entry) => serializeFileAuditHookPolicy(entry)),
  };
}

function normalizeHookState(value: unknown): WorkflowFileAuditHookState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const hookId = pickString(record, ["hookId", "hook_id"]);
  if (!hookId) {
    return null;
  }
  const status = normalizeStage(record.status);
  return {
    hookId,
    stage: normalizeStage(record.stage),
    hookPoint: normalizeHookPoint(record.hookPoint ?? record.hook_point),
    status:
      status === "auditing" ||
      status === "revise_requested" ||
      status === "passed" ||
      status === "failed" ||
      status === "escalated"
        ? status
        : "idle",
    roundsStarted: Math.max(0, Math.floor(pickNumber(record, ["roundsStarted", "rounds_started"]) ?? 0)),
    activeRound: normalizeRoundState(record.activeRound ?? record.active_round),
    lastPassedFingerprint: pickString(record, [
      "lastPassedFingerprint",
      "last_passed_fingerprint",
    ]),
    lastReviewedFingerprint: pickString(record, [
      "lastReviewedFingerprint",
      "last_reviewed_fingerprint",
    ]),
    lastVerdict: normalizeOptionalVerdict(record.lastVerdict ?? record.last_verdict),
    lastRevisionDispatch: normalizeRevisionDispatch(
      record.lastRevisionDispatch ?? record.last_revision_dispatch
    ),
    consecutiveUnchangedRounds: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "consecutiveUnchangedRounds",
          "consecutive_unchanged_rounds",
        ]) ?? 0
      )
    ),
    blockedReason: pickString(record, ["blockedReason", "blocked_reason"]),
    escalationReason: pickString(record, [
      "escalationReason",
      "escalation_reason",
    ]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]) ?? nowIso(),
  };
}

export function serializeHookState(
  state: WorkflowFileAuditHookState
): Record<string, unknown> {
  return {
    hook_id: state.hookId,
    stage: state.stage,
    hook_point: state.hookPoint,
    status: state.status,
    rounds_started: state.roundsStarted,
    active_round: state.activeRound,
    last_passed_fingerprint: state.lastPassedFingerprint,
    last_reviewed_fingerprint: state.lastReviewedFingerprint,
    last_verdict: state.lastVerdict,
    last_revision_dispatch: state.lastRevisionDispatch,
    consecutive_unchanged_rounds: state.consecutiveUnchangedRounds,
    blocked_reason: state.blockedReason,
    escalation_reason: state.escalationReason,
    updated_at: state.updatedAt,
  };
}

function normalizeAggregateState(value: unknown): WorkflowHookPointAggregateState {
  const record = asRecord(value) ?? {};
  const aggregateStatus = normalizeStage(record.aggregateStatus ?? record.aggregate_status);
  return {
    aggregateStatus:
      aggregateStatus === "auditing" ||
      aggregateStatus === "revise_requested" ||
      aggregateStatus === "passed" ||
      aggregateStatus === "failed" ||
      aggregateStatus === "escalated"
        ? aggregateStatus
        : "idle",
    aggregateVerdict: normalizeOptionalVerdict(
      record.aggregateVerdict ?? record.aggregate_verdict
    ),
    aggregateRevisionPacketPath: pickString(record, [
      "aggregateRevisionPacketPath",
      "aggregate_revision_packet_path",
    ]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]) ?? nowIso(),
  };
}

export function readWorkflowHooksStateStore(
  projectRoot: string
): Promise<WorkflowHooksStateStore> {
  return readJsonIfExists<Record<string, unknown>>(getWorkflowHooksStatePath(projectRoot)).then(
    (record) => {
      const root = asRecord(record) ?? {};
      const hookPointsRecord = asRecord(root.hookPoints ?? root.hook_points) ?? {};
      const hooksRecord = asRecord(root.hooks) ?? {};
      return {
        schemaVersion: 1,
        updatedAt: pickString(root, ["updatedAt", "updated_at"]) ?? nowIso(),
        hookPoints: Object.fromEntries(
          Object.entries(hookPointsRecord).map(([hookPoint, stageMap]) => [
            hookPoint,
            Object.fromEntries(
              Object.entries(asRecord(stageMap) ?? {}).map(([stage, entry]) => [
                stage,
                normalizeAggregateState(entry),
              ])
            ),
          ])
        ),
        hooks: Object.fromEntries(
          Object.entries(hooksRecord)
            .map(([hookId, entry]) => [hookId, normalizeHookState(entry)])
            .filter(([, entry]) => Boolean(entry)) as Array<
            [string, WorkflowFileAuditHookState]
          >
        ),
      };
    }
  );
}

export async function writeWorkflowHooksStateStore(
  projectRoot: string,
  store: WorkflowHooksStateStore
): Promise<void> {
  await writeJsonEnsured(getWorkflowHooksStatePath(projectRoot), {
    schemaVersion: 1,
    updated_at: store.updatedAt,
    hook_points: store.hookPoints,
    hooks: Object.fromEntries(
      Object.entries(store.hooks).map(([hookId, state]) => [hookId, serializeHookState(state)])
    ),
  });
}

export function getEmptyWorkflowHooksStateStore(): WorkflowHooksStateStore {
  return {
    schemaVersion: 1,
    updatedAt: nowIso(),
    hookPoints: {},
    hooks: {},
  };
}

export function buildWorkflowHookAggregateKey(params: {
  hookPoint: WorkflowHookPoint;
  stage: string | null;
}): { hookPoint: string; stage: string } {
  return {
    hookPoint: params.hookPoint,
    stage: params.stage ?? "__global__",
  };
}

export function upsertWorkflowHookAggregateState(params: {
  store: WorkflowHooksStateStore;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  aggregateState: WorkflowHookPointAggregateState;
}): WorkflowHooksStateStore {
  const key = buildWorkflowHookAggregateKey({
    hookPoint: params.hookPoint,
    stage: params.stage,
  });
  return {
    ...params.store,
    updatedAt: nowIso(),
    hookPoints: {
      ...params.store.hookPoints,
      [key.hookPoint]: {
        ...(params.store.hookPoints[key.hookPoint] ?? {}),
        [key.stage]: params.aggregateState,
      },
    },
  };
}

export function buildDefaultFileAuditHookState(params: {
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
}): WorkflowFileAuditHookState {
  return {
    hookId: params.hookId,
    stage: params.stage,
    hookPoint: params.hookPoint,
    status: "idle",
    roundsStarted: 0,
    activeRound: null,
    lastPassedFingerprint: null,
    lastReviewedFingerprint: null,
    lastVerdict: null,
    lastRevisionDispatch: null,
    consecutiveUnchangedRounds: 0,
    blockedReason: null,
    escalationReason: null,
    updatedAt: nowIso(),
  };
}

export async function readWorkflowHooksPolicyForProject(
  projectRoot: string
): Promise<WorkflowHooksPolicy> {
  const manifest = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  );
  return normalizeWorkflowHooksPolicy(manifest ?? {});
}

export async function setFileAuditPolicyForProject(params: {
  projectRoot: string;
  hookPolicies: unknown[];
  mode?: "replace" | "append";
}): Promise<WorkflowHooksPolicy> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const existing = normalizeWorkflowHooksPolicy(manifest);
  const incoming = params.hookPolicies
    .map((entry) => normalizeFileAuditHookPolicy(entry))
    .filter((entry): entry is WorkflowFileAuditHookPolicy => Boolean(entry));
  const mergedHooks =
    params.mode === "replace"
      ? incoming
      : [
          ...existing.auditHooks.filter(
            (entry) => !incoming.some((candidate) => candidate.hookId === entry.hookId)
          ),
          ...incoming,
        ];
  const nextPolicy: WorkflowHooksPolicy = {
    enabled: mergedHooks.length > 0,
    auditHooks: mergedHooks.sort((left, right) => {
      if (left.hookPoint !== right.hookPoint) {
        return left.hookPoint.localeCompare(right.hookPoint);
      }
      if ((left.stage ?? "") !== (right.stage ?? "")) {
        return (left.stage ?? "").localeCompare(right.stage ?? "");
      }
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.hookId.localeCompare(right.hookId);
    }),
  };
  manifest.workflow_hooks = serializeWorkflowHooksPolicy(nextPolicy);
  await writeJsonEnsured(manifestPath, manifest);
  return nextPolicy;
}

export async function getFileAuditStateSummary(params: {
  projectRoot: string;
}): Promise<{
  policy: WorkflowHooksPolicy;
  stateStore: WorkflowHooksStateStore;
}> {
  const [policy, stateStore] = await Promise.all([
    readWorkflowHooksPolicyForProject(params.projectRoot),
    readWorkflowHooksStateStore(params.projectRoot),
  ]);
  return {
    policy,
    stateStore,
  };
}

export type WorkflowHookPointContextInput = {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  ownerRole?: string | null;
  actorRole?: string | null;
  taskId?: string | null;
  handoffIntentId?: string | null;
  materializedArtifacts?: WorkflowMaterializedArtifact[];
  emittedHookEvents?: WorkflowHookEvent[];
};

export function buildWorkflowHookPointContext(
  input: WorkflowHookPointContextInput
) {
  return {
    projectRoot: input.projectRoot,
    projectId: input.projectId,
    stage: input.stage,
    hookPoint: input.hookPoint,
    ownerRole: input.ownerRole ?? null,
    actorRole: input.actorRole ?? null,
    taskId: input.taskId ?? null,
    handoffIntentId: input.handoffIntentId ?? null,
    materializedArtifacts: input.materializedArtifacts ?? [],
    emittedHookEvents: input.emittedHookEvents ?? [],
  };
}

export function sortHookPolicies(
  policies: WorkflowFileAuditHookPolicy[]
): WorkflowFileAuditHookPolicy[] {
  return [...policies].sort((left, right) => {
    if (left.hookPoint !== right.hookPoint) {
      return left.hookPoint.localeCompare(right.hookPoint);
    }
    if ((left.stage ?? "") !== (right.stage ?? "")) {
      return (left.stage ?? "").localeCompare(right.stage ?? "");
    }
    if ((left.parallelGroup ?? "") !== (right.parallelGroup ?? "")) {
      return (left.parallelGroup ?? "").localeCompare(right.parallelGroup ?? "");
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.hookId.localeCompare(right.hookId);
  });
}

export function summarizeHookExecutionResults(
  executions: WorkflowHookExecutionResult[]
): {
  aggregateVerdict: WorkflowHookPointAggregateVerdict;
  aggregateStatus: WorkflowHookPointAggregateState["aggregateStatus"];
  blockingReason: string | null;
  aggregateRevisionPacketPath: string | null;
} {
  if (executions.some((entry) => entry.escalated || entry.verdict === "block")) {
    return {
      aggregateVerdict: "block",
      aggregateStatus: executions.some((entry) => entry.escalated)
        ? "escalated"
        : "failed",
      blockingReason:
        executions.find((entry) => entry.blockingReason)?.blockingReason ??
        "At least one workflow hook blocked the current transition.",
      aggregateRevisionPacketPath:
        executions.find((entry) => entry.revisionDispatch?.aggregateRevisionPacketPath)
          ?.revisionDispatch?.aggregateRevisionPacketPath ?? null,
    };
  }
  if (executions.some((entry) => entry.revisedRequested || entry.verdict === "revise")) {
    return {
      aggregateVerdict: "revise",
      aggregateStatus: "revise_requested",
      blockingReason:
        executions.find((entry) => entry.blockingReason)?.blockingReason ??
        "Workflow hooks requested revision before the current transition can continue.",
      aggregateRevisionPacketPath:
        executions.find((entry) => entry.revisionDispatch?.aggregateRevisionPacketPath)
          ?.revisionDispatch?.aggregateRevisionPacketPath ?? null,
    };
  }
  if (executions.some((entry) => entry.pending || entry.status === "auditing")) {
    return {
      aggregateVerdict: null,
      aggregateStatus: "auditing",
      blockingReason: "Workflow hooks are still running for the current transition.",
      aggregateRevisionPacketPath: null,
    };
  }
  return {
    aggregateVerdict: "pass",
    aggregateStatus: executions.length > 0 ? "passed" : "idle",
    blockingReason: null,
    aggregateRevisionPacketPath: null,
  };
}
