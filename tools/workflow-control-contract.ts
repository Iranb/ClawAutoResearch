export type WorkflowControlStatus = "ready" | "waiting" | "blocked" | "failed";

export type WorkflowCompletionStatus =
  | "complete"
  | "incomplete"
  | "blocked"
  | "failed";

export type WorkflowRuntimeState = "idle" | "active" | "queued" | "degraded";

export type WorkflowControlCompletion = {
  status: WorkflowCompletionStatus;
  source: string;
  reason: string | null;
};

export type WorkflowControlContract = {
  schema_version: 1;
  contract_id: string;
  reconciled_at: string;
  stage: string | null;
  owner: string | null;
  next_action: string | null;
  status: WorkflowControlStatus;
  blocking_reason: string | null;
  completion: WorkflowControlCompletion;
  runtime_state: WorkflowRuntimeState;
  queue_key: string | null;
  session_key: string | null;
};

const WORKFLOW_CONTROL_STATUSES = new Set<WorkflowControlStatus>([
  "ready",
  "waiting",
  "blocked",
  "failed",
]);

const WORKFLOW_COMPLETION_STATUSES = new Set<WorkflowCompletionStatus>([
  "complete",
  "incomplete",
  "blocked",
  "failed",
]);

const WORKFLOW_RUNTIME_STATES = new Set<WorkflowRuntimeState>([
  "idle",
  "active",
  "queued",
  "degraded",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeControlStatus(value: unknown): WorkflowControlStatus | null {
  const normalized = asString(value);
  return normalized && WORKFLOW_CONTROL_STATUSES.has(normalized as WorkflowControlStatus)
    ? (normalized as WorkflowControlStatus)
    : null;
}

function normalizeCompletionStatus(
  value: unknown
): WorkflowCompletionStatus | null {
  const normalized = asString(value);
  return normalized &&
    WORKFLOW_COMPLETION_STATUSES.has(normalized as WorkflowCompletionStatus)
    ? (normalized as WorkflowCompletionStatus)
    : null;
}

function normalizeRuntimeState(value: unknown): WorkflowRuntimeState {
  const normalized = asString(value);
  return normalized && WORKFLOW_RUNTIME_STATES.has(normalized as WorkflowRuntimeState)
    ? (normalized as WorkflowRuntimeState)
    : "idle";
}

export function buildWorkflowControlContract(params: {
  contractId: string;
  reconciledAt: string;
  stage: string | null;
  owner: string | null;
  nextAction: string | null;
  status: WorkflowControlStatus;
  blockingReason?: string | null;
  completionStatus: WorkflowCompletionStatus;
  completionSource: string;
  completionReason?: string | null;
  runtimeState?: WorkflowRuntimeState;
  queueKey?: string | null;
  sessionKey?: string | null;
}): WorkflowControlContract {
  return {
    schema_version: 1,
    contract_id: params.contractId,
    reconciled_at: params.reconciledAt,
    stage: params.stage ?? null,
    owner: params.owner ?? null,
    next_action: params.nextAction ?? null,
    status: params.status,
    blocking_reason: params.blockingReason ?? null,
    completion: {
      status: params.completionStatus,
      source: params.completionSource,
      reason: params.completionReason ?? null,
    },
    runtime_state: params.runtimeState ?? "idle",
    queue_key: params.queueKey ?? null,
    session_key: params.sessionKey ?? null,
  };
}

export function normalizeWorkflowControlContract(
  value: unknown
): WorkflowControlContract | null {
  const record = asRecord(value);
  if (!record || record.schema_version !== 1) {
    return null;
  }
  const contractId = asString(record.contract_id);
  const reconciledAt = asString(record.reconciled_at);
  const status = normalizeControlStatus(record.status);
  const completionRecord = asRecord(record.completion);
  const completionStatus = normalizeCompletionStatus(completionRecord?.status);
  const completionSource = asString(completionRecord?.source);
  if (
    !contractId ||
    !reconciledAt ||
    !status ||
    !completionRecord ||
    !completionStatus ||
    !completionSource
  ) {
    return null;
  }
  return {
    schema_version: 1,
    contract_id: contractId,
    reconciled_at: reconciledAt,
    stage: asString(record.stage),
    owner: asString(record.owner),
    next_action: asString(record.next_action),
    status,
    blocking_reason: asString(record.blocking_reason),
    completion: {
      status: completionStatus,
      source: completionSource,
      reason: asString(completionRecord.reason),
    },
    runtime_state: normalizeRuntimeState(record.runtime_state),
    queue_key: asString(record.queue_key),
    session_key: asString(record.session_key),
  };
}

export function applyWorkflowControlContractToManifest<T extends Record<string, unknown>>(
  manifest: T,
  contract: WorkflowControlContract
): T & {
  workflow_control: WorkflowControlContract;
  current_stage: string | null;
  owner_agent: string | null;
  next_action: string | null;
  blocking_reason: string | null;
} {
  return {
    ...manifest,
    workflow_control: contract,
    current_stage: contract.stage,
    owner_agent: contract.owner,
    next_action: contract.next_action,
    blocking_reason: contract.blocking_reason,
  };
}
