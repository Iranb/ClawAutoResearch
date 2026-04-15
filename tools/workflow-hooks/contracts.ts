export const WORKFLOW_HOOK_POINTS = [
  "artifact_materialized",
  "before_stage_handoff",
  "after_stage_handoff",
  "before_task_complete",
  "before_stage_complete",
  "before_handoff_activation",
  "after_handoff_activation",
] as const;

export type WorkflowHookPoint = (typeof WORKFLOW_HOOK_POINTS)[number];

export const WORKFLOW_HOOK_TYPES = ["file_audit"] as const;
export type WorkflowHookType = (typeof WORKFLOW_HOOK_TYPES)[number];

export const WORKFLOW_HOOK_BLOCKING_MODES = [
  "block_stage",
  "warn_only",
  "rollback_stage",
] as const;
export type WorkflowHookBlockingMode = (typeof WORKFLOW_HOOK_BLOCKING_MODES)[number];

export const WORKFLOW_FILE_AUDIT_VERDICTS = ["pass", "revise", "block"] as const;
export type WorkflowFileAuditVerdict = (typeof WORKFLOW_FILE_AUDIT_VERDICTS)[number];

export type WorkflowFileAuditViolation = {
  rule: string;
  severity: "low" | "medium" | "high" | "critical";
  location: string | null;
  message: string;
};

export type WorkflowFileAuditResult = {
  verdict: WorkflowFileAuditVerdict;
  summary: string | null;
  violations: WorkflowFileAuditViolation[];
  requiredFixes: string[];
  reviewedArtifacts: string[];
  confidence: number | null;
  runId: string | null;
  rawText: string | null;
  reviewerRole: string;
  filePath: string;
  fileFingerprint: string | null;
  createdAt: string;
};

export type WorkflowMaterializedArtifact = {
  contract: string;
  artifactPath: string | null;
  fingerprint: string | null;
  action: "created" | "updated" | "reconciled";
};

export type WorkflowHookEvent = {
  hookPoint: WorkflowHookPoint;
  contract: string | null;
  artifactPath: string | null;
};

export type WorkflowHookPointContext = {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  ownerRole: string | null;
  actorRole: string | null;
  taskId: string | null;
  handoffIntentId: string | null;
  materializedArtifacts: WorkflowMaterializedArtifact[];
  emittedHookEvents: WorkflowHookEvent[];
};

export type WorkflowFileAuditHookPolicy = {
  hookId: string;
  hookType: "file_audit";
  enabled: boolean;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  order: number;
  parallelGroup: string | null;
  targetRole: string | null;
  auditorRole: string;
  filePath: string;
  requirementPrompt: string;
  supportingArtifacts: string[];
  blockingMode: WorkflowHookBlockingMode;
  maxRounds: number;
  maxUnchangedRounds: number;
  reviseOwnerRole: string | null;
  reviseCommand: string | null;
  reportDir: string | null;
};

export type WorkflowHooksPolicy = {
  enabled: boolean;
  auditHooks: WorkflowFileAuditHookPolicy[];
};

export type WorkflowHookAttemptStatus = "pending" | "completed" | "error";
export type WorkflowHookRunStatus =
  | "idle"
  | "auditing"
  | "revise_requested"
  | "passed"
  | "failed"
  | "escalated";

export type WorkflowHookReviewerAttempt<T> = {
  hookId: string;
  reviewerRole: string;
  sessionKey: string;
  runId: string | null;
  status: WorkflowHookAttemptStatus;
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: T | null;
};

export type WorkflowFileAuditRoundState = {
  roundId: string;
  status: WorkflowHookAttemptStatus;
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  auditorRole: string;
  targetRole: string | null;
  filePath: string;
  fileFingerprint: string | null;
  packetPath: string;
  packetJsonPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  runId: string | null;
  sessionKey: string;
  launchedAt: string;
  completedAt: string | null;
  result: WorkflowFileAuditResult | null;
  error: string | null;
};

export type WorkflowHookRevisionDispatchState = {
  runId: string | null;
  sessionKey: string | null;
  dispatchedAt: string;
  targetRole: string | null;
  aggregateRevisionPacketPath: string | null;
};

export type WorkflowFileAuditHookState = {
  hookId: string;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  status: WorkflowHookRunStatus;
  roundsStarted: number;
  activeRound: WorkflowFileAuditRoundState | null;
  lastPassedFingerprint: string | null;
  lastReviewedFingerprint: string | null;
  lastVerdict: WorkflowFileAuditVerdict | null;
  lastRevisionDispatch: WorkflowHookRevisionDispatchState | null;
  consecutiveUnchangedRounds: number;
  blockedReason: string | null;
  escalationReason: string | null;
  updatedAt: string;
};

export type WorkflowHookPointAggregateVerdict = "pass" | "revise" | "block" | null;

export type WorkflowHookPointAggregateState = {
  aggregateStatus: WorkflowHookRunStatus;
  aggregateVerdict: WorkflowHookPointAggregateVerdict;
  aggregateRevisionPacketPath: string | null;
  updatedAt: string;
};

export type WorkflowHooksStateStore = {
  schemaVersion: 1;
  updatedAt: string;
  hookPoints: Record<string, Record<string, WorkflowHookPointAggregateState>>;
  hooks: Record<string, WorkflowFileAuditHookState>;
};

export type WorkflowHookExecutionResult = {
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  verdict: WorkflowHookPointAggregateVerdict;
  status: WorkflowHookRunStatus;
  pending: boolean;
  launched: boolean;
  revisedRequested: boolean;
  escalated: boolean;
  fileFingerprint: string | null;
  result: WorkflowFileAuditResult | null;
  revisionDispatch: WorkflowHookRevisionDispatchState | null;
  blockingReason: string | null;
};

export type WorkflowHookPointExecutionSummary = {
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  aggregateVerdict: WorkflowHookPointAggregateVerdict;
  aggregateStatus: WorkflowHookRunStatus;
  hooksRun: WorkflowHookExecutionResult[];
  blockingReason: string | null;
  aggregateRevisionPacketPath: string | null;
};
