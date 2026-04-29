export const DEFAULT_CAPABILITY_COMPLETION_DIR =
  "researcher/capability-completion";

export type CapabilityCompletionMode =
  | "autoresearch"
  | "autoreview"
  | "e2e_repair"
  | "survey"
  | "experiment"
  | "full"
  | "unknown";

export type CapabilityCompletionStatus =
  | "completed"
  | "planned"
  | "degraded"
  | "blocked"
  | "failed";

export type CapabilityPriority =
  | "literature"
  | "evidence_chain"
  | "storyline"
  | "evaluator"
  | "repair_console"
  | "writeback";

export type CapabilityGapStatus =
  | "satisfied"
  | "runnable"
  | "planned"
  | "deferred"
  | "blocked"
  | "degraded";

export type CapabilitySeverity = "critical" | "high" | "medium" | "low";

export type CapabilityGapRecord = {
  id: string;
  capability: CapabilityPriority;
  code: string;
  status: CapabilityGapStatus;
  severity: CapabilitySeverity;
  summary: string;
  source_artifacts: string[];
  expected_artifacts: string[];
  can_auto_execute: boolean;
  blocked_by_auth: boolean;
  blocked_by_missing_artifact: boolean;
  degradable: boolean;
  deferred_until: string | null;
  next_action: string;
  details: Record<string, unknown>;
};

export type CapabilityExecutionActionStatus =
  | "runnable"
  | "executed"
  | "planned"
  | "deferred"
  | "blocked"
  | "skipped"
  | "failed";

export type CapabilityExecutionAction = {
  id: string;
  capability: CapabilityPriority;
  gap_id: string;
  status: CapabilityExecutionActionStatus;
  tool_action: string;
  existing_tool: boolean;
  owner: string;
  inputs: Record<string, unknown>;
  expected_artifacts: string[];
  retry_policy: {
    transient_retries: number;
    provider_429_wait_seconds: number;
    papernexus_retries: number;
  };
  reason: string;
  result: Record<string, unknown> | null;
};

export type CapabilityGapInventoryArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  mode: CapabilityCompletionMode;
  trigger: string;
  priority_order: CapabilityPriority[];
  status: CapabilityCompletionStatus;
  open_gap_count: number;
  runnable_gap_count: number;
  blocked_gap_count: number;
  deferred_gap_count: number;
  degraded_gap_count: number;
  gaps: CapabilityGapRecord[];
};

export type CapabilityExecutionPlanArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  status: CapabilityCompletionStatus;
  runnable_action_count: number;
  planned_action_count: number;
  blocked_action_count: number;
  deferred_action_count: number;
  actions: CapabilityExecutionAction[];
};

export type CapabilityRunReceiptArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  mode: CapabilityCompletionMode;
  trigger: string;
  status: CapabilityCompletionStatus;
  executed: boolean;
  executed_action_count: number;
  failed_action_count: number;
  skipped_action_count: number;
  terminal_reason: string;
  next_actions: string[];
  artifact_paths: CapabilityCompletionArtifactPaths;
};

export type CapabilityClaimCapReportArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  status: CapabilityCompletionStatus;
  current_claim_strength_cap: string | null;
  recommended_claim_strength_cap: string;
  reasons: string[];
  evidence_chain_eligible: boolean;
  dataset_backed_claim_eligible: boolean;
  venue_competitive_claim_eligible: boolean;
};

export type CapabilityProviderCacheManifestArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  provider_result_index_path: string | null;
  provider_query_count: number;
  cached_provider_count: number;
  error_count: number;
  auth_error_count: number;
  rate_limit_count: number;
  deferred_until: string | null;
};

export type CapabilityRerunGatePlanArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  status: CapabilityCompletionStatus;
  gates: Array<{
    id: string;
    reason: string;
    command: string;
    expected_artifacts: string[];
  }>;
};

export type CapabilityCompletionArtifactPaths = {
  status_markdown_path: string;
  gap_inventory_path: string;
  execution_plan_path: string;
  run_receipt_path: string;
  trace_path: string;
  repair_queue_path: string;
  claim_cap_report_path: string;
  provider_cache_manifest_path: string;
  rerun_gate_plan_path: string;
};

export type CapabilityCompletionArtifacts = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  mode: CapabilityCompletionMode;
  trigger: string;
  status: CapabilityCompletionStatus;
  gap_inventory: CapabilityGapInventoryArtifact;
  execution_plan: CapabilityExecutionPlanArtifact;
  run_receipt: CapabilityRunReceiptArtifact;
  claim_cap_report: CapabilityClaimCapReportArtifact;
  provider_cache_manifest: CapabilityProviderCacheManifestArtifact;
  rerun_gate_plan: CapabilityRerunGatePlanArtifact;
  artifact_paths: CapabilityCompletionArtifactPaths;
  relative_artifact_paths: CapabilityCompletionArtifactPaths;
};
