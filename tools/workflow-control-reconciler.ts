import { createHash } from "node:crypto";
import * as path from "node:path";

import {
  asRecord,
  asString,
  normalizeStage,
} from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import {
  applyWorkflowControlContractToManifest,
  buildWorkflowControlContract,
  normalizeWorkflowControlContract,
  type WorkflowControlContract,
  type WorkflowControlStatus,
} from "./workflow-control-contract.js";
import {
  resolveRuntimeOwnership,
  resolveWorkflowStageCompletion,
  type StageCompletion,
} from "./workflow-stage-completion";

export type WorkflowControlReconcilePolicy = {
  allowProjectionRepair?: boolean;
  staleRuntimeAgeMs?: number;
};

export type WorkflowControlReconcileDiagnostic = {
  kind: string;
  message: string;
  path?: string;
};

export type WorkflowControlReconcileResult = {
  contract: WorkflowControlContract;
  stageCompletion: StageCompletion;
  projectionRepaired: boolean;
  diagnostics: WorkflowControlReconcileDiagnostic[];
  manifest: Record<string, unknown>;
};

export type WorkflowControlStageSignalResolver = (params: {
  projectRoot: string;
  stage: string;
  manifest: Record<string, unknown>;
  completion: StageCompletion;
}) => Promise<string[]>;

function makeContractId(params: {
  stage: string | null;
  now: string;
  source: string;
  reason: string | null;
}): string {
  const stage = normalizeStage(params.stage) ?? "unknown";
  const digest = createHash("sha1")
    .update(`${params.now}:${stage}:${params.source}:${params.reason ?? ""}`)
    .digest("hex")
    .slice(0, 10);
  return `wfctl_${stage}_${digest}`;
}

function resolveReconcileStage(params: {
  manifest: Record<string, unknown>;
  explicitManifest: boolean;
}): string {
  const existing = normalizeWorkflowControlContract(params.manifest.workflow_control);
  const projectedStage = normalizeStage(params.manifest.current_stage);
  const canonicalStage = normalizeStage(existing?.stage);
  return (
    params.explicitManifest
      ? projectedStage ?? canonicalStage
      : canonicalStage ?? projectedStage
  ) ?? "setup";
}

function controlStatusFor(params: {
  completion: StageCompletion;
  runtimeBlockingReason: string | null;
}): WorkflowControlStatus {
  if (params.completion.completionStatus === "failed") {
    return "failed";
  }
  if (params.completion.completionStatus === "blocked") {
    return "blocked";
  }
  if (params.completion.blockingReason || params.runtimeBlockingReason) {
    return "waiting";
  }
  return "ready";
}

function isExperimentDecisionBlocker(value: string | null | undefined): boolean {
  const blocker = normalizeStage(value);
  return Boolean(
    blocker &&
      [
        "experiment_repair_implementation",
        "launch_pending",
        "continue_tuning",
        "require_multi_seed",
        "reconcile_runtime",
        "rollback_to_plan",
        "rollback_to_idea",
        "experiment_search_stop_or_analysis_decision_pending",
      ].includes(blocker)
  );
}

function repairProjection(params: {
  manifest: Record<string, unknown>;
  completion: StageCompletion;
  now: string;
  diagnostics: WorkflowControlReconcileDiagnostic[];
}): boolean {
  if (params.completion.completionStatus !== "complete") {
    return false;
  }
  if (!params.completion.repairProjection) {
    return false;
  }
  if (params.completion.stage === "graph_build") {
    params.manifest.paper_ingestion = {
      ...(asRecord(params.manifest.paper_ingestion) ?? {}),
      graph_presence_status: "ready",
      workflow_control_repaired_at: params.now,
    };
    params.diagnostics.push({
      kind: "projection_repaired",
      message: "Repaired paper_ingestion graph presence projection from canonical graph evidence.",
      path: "PROJECT_MANIFEST.json.paper_ingestion",
    });
    return true;
  }
  if (params.completion.stage === "plan") {
    params.manifest.research_program = {
      ...(asRecord(params.manifest.research_program) ?? {}),
      status: "ready",
      plan_artifacts_status: "ready",
      workflow_control_repaired_at: params.now,
    };
    params.diagnostics.push({
      kind: "projection_repaired",
      message: "Repaired research_program projection from complete plan artifacts.",
      path: "PROJECT_MANIFEST.json.research_program",
    });
    return true;
  }
  return false;
}

function withResolvedStageSignals(params: {
  completion: StageCompletion;
  requestedStage: string;
  signals: string[];
}): StageCompletion {
  const requestedStage = normalizeStage(params.requestedStage);
  const completionStage = normalizeStage(params.completion.stage);
  const signals = [
    ...(params.completion.missingSignals ?? []),
    ...params.signals,
  ]
    .filter((signal) => signal.trim().length > 0)
    .filter(
      (signal, index, list) =>
        list.findIndex((candidate) => candidate === signal) === index
    )
    .filter((signal) => {
      if (!requestedStage || requestedStage === completionStage) {
        return true;
      }
      return !/^orchestration_state\.next_transition_candidate\b/i.test(signal);
    });
  if (params.completion.completionStatus === "failed") {
    return { ...params.completion, missingSignals: signals };
  }
  if (params.completion.completionStatus === "blocked") {
    return { ...params.completion, missingSignals: signals };
  }
  if (params.completion.completionStatus === "complete") {
    return { ...params.completion, missingSignals: [] };
  }
  if (signals.length > 0) {
    return {
      ...params.completion,
      completionStatus: "incomplete",
      blockingReason: params.completion.blockingReason ?? signals[0] ?? null,
      missingSignals: signals,
    };
  }
  if (
    params.completion.completionStatus === "incomplete" &&
    params.completion.blockingReason
  ) {
    return {
      ...params.completion,
      missingSignals: signals,
    };
  }
  return {
    ...params.completion,
    completionStatus: "complete",
    blockingReason: null,
    missingSignals: [],
  };
}

export async function reconcileWorkflowControl(params: {
  projectRoot: string;
  policy?: WorkflowControlReconcilePolicy;
  now?: string;
  manifest?: Record<string, unknown>;
  stageSignalResolver?: WorkflowControlStageSignalResolver;
}): Promise<WorkflowControlReconcileResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = {
    ...((params.manifest ??
      (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ??
      {}) as Record<string, unknown>),
  };
  const now = params.now ?? new Date().toISOString();
  const diagnostics: WorkflowControlReconcileDiagnostic[] = [];
  const stage = resolveReconcileStage({
    manifest,
    explicitManifest: Boolean(params.manifest),
  });
  const existingControl = normalizeWorkflowControlContract(manifest.workflow_control);
  const existingControlForStage =
    normalizeStage(existingControl?.stage) === stage ? existingControl : null;
  const resolvedStageCompletion = await resolveWorkflowStageCompletion({
    projectRoot,
    stage,
  });
  const stageCompletion = params.stageSignalResolver
    ? withResolvedStageSignals({
        completion: resolvedStageCompletion,
        requestedStage: stage,
        signals: await params.stageSignalResolver({
          projectRoot,
          stage: resolvedStageCompletion.stage,
          manifest,
          completion: resolvedStageCompletion,
        }),
      })
    : resolvedStageCompletion;
  const canonicalCompletionOverride =
    stageCompletion.stage !== stage ||
    (stageCompletion.stage === "experiment" &&
      isExperimentDecisionBlocker(stageCompletion.blockingReason)) ||
    stageCompletion.completionStatus === "complete";
  const effectiveStageCompletion: StageCompletion = {
    ...stageCompletion,
    owner:
      canonicalCompletionOverride
        ? stageCompletion.owner ??
          existingControlForStage?.owner ??
          asString(manifest.owner_agent) ??
          null
        : existingControlForStage?.owner ??
          asString(manifest.owner_agent) ??
          stageCompletion.owner ??
          null,
    nextAction:
      canonicalCompletionOverride
        ? stageCompletion.nextAction ??
          existingControlForStage?.next_action ??
          asString(manifest.next_action) ??
          null
        : existingControlForStage?.next_action ??
          asString(manifest.next_action) ??
          stageCompletion.nextAction ??
          null,
  };
  const runtimeOwnership = await resolveRuntimeOwnership(projectRoot, {
    stage: effectiveStageCompletion.stage,
    owner: effectiveStageCompletion.owner,
    nextAction: effectiveStageCompletion.nextAction,
    staleRuntimeAgeMs: params.policy?.staleRuntimeAgeMs,
    now,
  });
  const projectionRepaired =
    params.policy?.allowProjectionRepair === false
      ? false
      : repairProjection({
          manifest,
          completion: effectiveStageCompletion,
          now,
          diagnostics,
        });
  const blockingReason =
    effectiveStageCompletion.blockingReason ?? runtimeOwnership.blockingReason ?? null;
  const contract = buildWorkflowControlContract({
    contractId: makeContractId({
      stage: effectiveStageCompletion.stage,
      now,
      source: effectiveStageCompletion.contractSource,
      reason: blockingReason,
    }),
    reconciledAt: now,
    stage: effectiveStageCompletion.stage,
    owner: effectiveStageCompletion.owner,
    nextAction: effectiveStageCompletion.nextAction,
    status: controlStatusFor({
      completion: effectiveStageCompletion,
      runtimeBlockingReason: runtimeOwnership.blockingReason ?? null,
    }),
    blockingReason,
    completionStatus: effectiveStageCompletion.completionStatus,
    completionSource: effectiveStageCompletion.contractSource,
    completionReason:
      blockingReason ??
      (effectiveStageCompletion.completionStatus === "incomplete"
        ? "owner_work_required"
        : null),
    runtimeState: runtimeOwnership.runtimeState ?? effectiveStageCompletion.runtimeState ?? "idle",
    queueKey: runtimeOwnership.queueKey ?? effectiveStageCompletion.queueKey ?? null,
    sessionKey: runtimeOwnership.sessionKey ?? effectiveStageCompletion.sessionKey ?? null,
  });
  const nextManifest = applyWorkflowControlContractToManifest(manifest, contract);
  await writeJsonAtomicEnsured(manifestPath, nextManifest);
  return {
    contract,
    stageCompletion: effectiveStageCompletion,
    projectionRepaired,
    diagnostics,
    manifest: nextManifest,
  };
}
