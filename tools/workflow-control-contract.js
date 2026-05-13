const WORKFLOW_CONTROL_STATUSES = new Set([
  "ready",
  "waiting",
  "blocked",
  "failed",
]);
const WORKFLOW_COMPLETION_STATUSES = new Set([
  "complete",
  "incomplete",
  "blocked",
  "failed",
]);
const WORKFLOW_RUNTIME_STATES = new Set([
  "idle",
  "active",
  "queued",
  "degraded",
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeControlStatus(value) {
  const normalized = asString(value);
  return normalized && WORKFLOW_CONTROL_STATUSES.has(normalized)
    ? normalized
    : null;
}

function normalizeCompletionStatus(value) {
  const normalized = asString(value);
  return normalized && WORKFLOW_COMPLETION_STATUSES.has(normalized)
    ? normalized
    : null;
}

function normalizeRuntimeState(value) {
  const normalized = asString(value);
  return normalized && WORKFLOW_RUNTIME_STATES.has(normalized)
    ? normalized
    : "idle";
}

export function buildWorkflowControlContract(params) {
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

export function normalizeWorkflowControlContract(value) {
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

export function applyWorkflowControlContractToManifest(manifest, contract) {
  return {
    ...manifest,
    workflow_control: contract,
    current_stage: contract.stage,
    owner_agent: contract.owner,
    next_action: contract.next_action,
    blocking_reason: contract.blocking_reason,
  };
}
