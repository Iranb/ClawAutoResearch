import { asRecord, normalizeStage, pickString } from "../workflow-guard-core/coercion";

export type AutoDispatchDiagnosticsState = {
  status: "ready" | "blocked" | "degraded" | "waiting" | "stale";
  lastCheckedAt: string | null;
  blockingLayer: "risk" | "hook" | "signals" | "dispatch" | "runtime" | "mailbox" | null;
  blockingReason: string | null;
  blockingSummary: string | null;
  stageAfter: string | null;
  ownerAfter: string | null;
  effectiveAutoMode: string | null;
  riskFingerprint: string | null;
  activeHookPoint: string | null;
  aggregateHookVerdict: string | null;
  runtimeSessionHealth: string | null;
  mailboxStatus: string | null;
  nextRepairAction: string | null;
};

export function normalizeAutoDispatchDiagnosticsState(
  value: unknown
): AutoDispatchDiagnosticsState {
  const record = asRecord(value) ?? {};
  const status = normalizeStage(record.status);
  const blockingLayer = normalizeStage(record.blockingLayer ?? record.blocking_layer);
  return {
    status:
      status === "ready" ||
      status === "blocked" ||
      status === "degraded" ||
      status === "waiting" ||
      status === "stale"
        ? status
        : "waiting",
    lastCheckedAt: pickString(record, ["lastCheckedAt", "last_checked_at"]),
    blockingLayer:
      blockingLayer === "risk" ||
      blockingLayer === "hook" ||
      blockingLayer === "signals" ||
      blockingLayer === "dispatch" ||
      blockingLayer === "runtime" ||
      blockingLayer === "mailbox"
        ? blockingLayer
        : null,
    blockingReason: pickString(record, ["blockingReason", "blocking_reason"]),
    blockingSummary: pickString(record, ["blockingSummary", "blocking_summary"]),
    stageAfter: normalizeStage(record.stageAfter ?? record.stage_after),
    ownerAfter: pickString(record, ["ownerAfter", "owner_after"]),
    effectiveAutoMode: pickString(record, ["effectiveAutoMode", "effective_auto_mode"]),
    riskFingerprint: pickString(record, ["riskFingerprint", "risk_fingerprint"]),
    activeHookPoint: pickString(record, ["activeHookPoint", "active_hook_point"]),
    aggregateHookVerdict: pickString(record, ["aggregateHookVerdict", "aggregate_hook_verdict"]),
    runtimeSessionHealth: pickString(record, ["runtimeSessionHealth", "runtime_session_health"]),
    mailboxStatus: pickString(record, ["mailboxStatus", "mailbox_status"]),
    nextRepairAction: pickString(record, ["nextRepairAction", "next_repair_action"]),
  };
}

export function serializeAutoDispatchDiagnosticsState(
  value: AutoDispatchDiagnosticsState
): Record<string, unknown> {
  return {
    status: value.status,
    last_checked_at: value.lastCheckedAt,
    blocking_layer: value.blockingLayer,
    blocking_reason: value.blockingReason,
    blocking_summary: value.blockingSummary,
    stage_after: value.stageAfter,
    owner_after: value.ownerAfter,
    effective_auto_mode: value.effectiveAutoMode,
    risk_fingerprint: value.riskFingerprint,
    active_hook_point: value.activeHookPoint,
    aggregate_hook_verdict: value.aggregateHookVerdict,
    runtime_session_health: value.runtimeSessionHealth,
    mailbox_status: value.mailboxStatus,
    next_repair_action: value.nextRepairAction,
  };
}
