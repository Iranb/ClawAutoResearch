import { createHash } from "node:crypto";
import path from "node:path";
import { deriveAgentSessionKeyForRole } from "../agent-task-dispatch";
import { normalizeWorkflowControlContract } from "../workflow-control-contract.js";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  normalizeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import type { WorkflowHandoffIntent } from "../workflow-handoff/handoff-types";
import {
  buildWorkflowHookAggregateKey,
  readWorkflowHooksPolicyForProject,
  readWorkflowHooksStateStore,
} from "./state.js";
import { mergeBuiltinWorkflowHooksIntoSummary } from "./builtin-bridge.js";
import { evaluateWorkflowHooksForPoint } from "./executor.js";
import { buildWorkflowHookPointContext } from "./point-context.js";
import type { WorkflowExecutionRuntimeLike } from "../workflow-execution-runtime.js";
import type {
  WorkflowGateControlPackage,
  WorkflowHookPoint,
  WorkflowHookPointExecutionSummary,
  WorkflowLine,
  WorkflowPaperMode,
} from "./contracts.js";
type WorkflowRuntimeApi = WorkflowExecutionRuntimeLike;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHookReviewerRole(
  value: string | null | undefined
): Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"] | null {
  if (
    value === "researcher" ||
    value === "planner" ||
    value === "orchestrator" ||
    value === "coder" ||
    value === "analyzer" ||
    value === "academic_writer" ||
    value === "reviewer" ||
    value === "cross-reviewer"
  ) {
    return value;
  }
  return null;
}

function hashGatePayload(value: unknown): string {
  return `sha1:${createHash("sha1").update(JSON.stringify(value ?? null)).digest("hex")}`;
}

async function readHookEnvironment(projectRoot: string): Promise<{
  workflowLine: WorkflowLine;
  paperMode: WorkflowPaperMode | null;
}> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const workflowControl = normalizeWorkflowControlContract(manifest.workflow_control);
  const currentStage =
    workflowControl?.stage ?? readString(manifest.current_stage);
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  return {
    workflowLine:
      readString(manifest.workflow_line) === "survey" ||
      readString(manifest.paper_type) === "survey" ||
      writingContract.paperMode === "survey" ||
      currentStage === "survey_review"
        ? "survey"
        : "experiment",
    paperMode: writingContract.paperMode,
  };
}

export type WorkflowHandoffHookGateRecord = {
  hookGatePoint: WorkflowHookPoint;
  hookGateFingerprint: string;
  hookGateVerdict: "pass" | "revise" | "block" | null;
  hookGateStatus: string;
  hookGateCheckedAt: string;
  hookGatePolicyIds: string[];
  hookGateRevisionPacketPath: string | null;
};

export type WorkflowHandoffHookGateResult = {
  allowed: boolean;
  hookPoint: WorkflowHookPoint;
  aggregateVerdict: "pass" | "revise" | "block" | null;
  aggregateStatus: string;
  blockingReason: string | null;
  aggregateRevisionPacketPath: string | null;
  gateControl?: WorkflowGateControlPackage | null;
  hookGate: WorkflowHandoffHookGateRecord | null;
};

export function buildWorkflowHandoffHookGateFingerprint(params: {
  projectRoot: string;
  projectId: string | null;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  ownerBefore: string | null;
  ownerAfter: string | null;
  aggregateVerdict: string | null;
  aggregateStatus: string | null;
  aggregateRevisionPacketPath: string | null;
  hookGatePolicyIds: string[];
}): string {
  return hashGatePayload({
    projectRoot: path.resolve(params.projectRoot),
    projectId: params.projectId,
    hookPoint: params.hookPoint,
    stage: params.stage,
    ownerBefore: params.ownerBefore,
    ownerAfter: params.ownerAfter,
    aggregateVerdict: params.aggregateVerdict,
    aggregateStatus: params.aggregateStatus,
    aggregateRevisionPacketPath: params.aggregateRevisionPacketPath,
    hookGatePolicyIds: [...params.hookGatePolicyIds].sort(),
  });
}

export function buildWorkflowHandoffHookGateRecord(params: {
  projectRoot: string;
  projectId: string | null;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  ownerBefore: string | null;
  ownerAfter: string | null;
  summary: WorkflowHookPointExecutionSummary;
}): WorkflowHandoffHookGateRecord | null {
  const hookGatePolicyIds = params.summary.hooksRun.map((entry) => entry.hookId);
  if (hookGatePolicyIds.length === 0) {
    return null;
  }
  return {
    hookGatePoint: params.hookPoint,
    hookGateFingerprint: buildWorkflowHandoffHookGateFingerprint({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      hookPoint: params.hookPoint,
      stage: params.stage,
      ownerBefore: params.ownerBefore,
      ownerAfter: params.ownerAfter,
      aggregateVerdict: params.summary.aggregateVerdict,
      aggregateStatus: params.summary.aggregateStatus,
      aggregateRevisionPacketPath: params.summary.aggregateRevisionPacketPath,
      hookGatePolicyIds,
    }),
    hookGateVerdict: params.summary.aggregateVerdict,
    hookGateStatus: params.summary.aggregateStatus,
    hookGateCheckedAt: nowIso(),
    hookGatePolicyIds,
    hookGateRevisionPacketPath: params.summary.aggregateRevisionPacketPath,
  };
}

export async function evaluateWorkflowHandoffHooks(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  projectRoot: string;
  projectId: string | null;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  ownerBefore: string | null;
  ownerAfter: string | null;
  requesterSessionKey?: string | null;
  requesterChannel?: string | null;
  handoffIntentId?: string | null;
  transition?: string | null;
}): Promise<WorkflowHandoffHookGateResult> {
  const environment = await readHookEnvironment(params.projectRoot);
  const summary = await evaluateWorkflowHooksForPoint({
    workflowRuntime: params.workflowRuntime,
    requesterSessionKey: params.requesterSessionKey,
    requesterChannel: params.requesterChannel,
    context: buildWorkflowHookPointContext({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      stage: params.stage,
      hookPoint: params.hookPoint,
      ownerRole: params.ownerAfter,
      actorRole: params.ownerBefore,
      targetRole: params.ownerAfter,
      handoffIntentId: params.handoffIntentId,
      workflowLine: environment.workflowLine,
      paperMode: environment.paperMode,
      targetStage: params.stage,
      transition: params.transition ?? params.hookPoint,
    }),
    launchReviewerRun:
      params.workflowRuntime?.run != null
        ? async (launchParams) => {
            const reviewerRole = normalizeHookReviewerRole(launchParams.reviewerRole);
            if (!reviewerRole) {
              return {
                launched: false,
                runId: null,
                sessionKey: launchParams.sessionKey,
                error: `Unsupported hook reviewer role: ${launchParams.reviewerRole}`,
              };
            }
            const sessionKey = deriveAgentSessionKeyForRole({
              requesterSessionKey: params.requesterSessionKey ?? undefined,
              targetRole: reviewerRole,
            });
            try {
              const started = await params.workflowRuntime!.run!({
                sessionKey,
                message: launchParams.message,
                lane: "nested",
                deliver: false,
                idempotencyKey: launchParams.idempotencyKey,
                extraSystemPrompt:
                  "Workflow handoff hook reviewer.\n" +
                  "Audit only the supplied handoff gate packet and return the required JSON schema.",
                projectRoot: params.projectRoot,
                projectId: params.projectId,
                ownerAgent: reviewerRole,
                requesterSessionKey: params.requesterSessionKey ?? null,
                messageChannel: params.requesterChannel ?? null,
                workspaceDir: params.projectRoot,
              });
              return {
                launched: true,
                runId: started.runId,
                sessionKey,
                error: null,
              };
            } catch (error) {
              return {
                launched: false,
                runId: null,
                sessionKey,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }
        : undefined,
  });
  const mergedSummary = await mergeBuiltinWorkflowHooksIntoSummary({
    projectRoot: params.projectRoot,
    hookPoint: params.hookPoint,
    stage: params.stage,
    summary,
  });
  const hookGate = buildWorkflowHandoffHookGateRecord({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    hookPoint: params.hookPoint,
    stage: params.stage,
    ownerBefore: params.ownerBefore,
    ownerAfter: params.ownerAfter,
    summary: mergedSummary,
  });
  const nonBlockingDebtOrWarning =
    !mergedSummary.gateControl.blocking &&
    mergedSummary.gateControl.repairRequiredCount === 0 &&
    (mergedSummary.gateControl.deferredDebtCount > 0 ||
      mergedSummary.gateControl.warnOnlyCount > 0);
  const allowed =
    mergedSummary.hooksRun.length === 0 ||
    mergedSummary.aggregateVerdict === "pass" ||
    nonBlockingDebtOrWarning;
  return {
    allowed,
    hookPoint: params.hookPoint,
    aggregateVerdict: mergedSummary.aggregateVerdict,
    aggregateStatus: mergedSummary.aggregateStatus,
    blockingReason: mergedSummary.blockingReason,
    aggregateRevisionPacketPath: mergedSummary.aggregateRevisionPacketPath,
    gateControl: mergedSummary.gateControl,
    hookGate,
  };
}

export async function checkHandoffHookFreshness(params: {
  intent: WorkflowHandoffIntent;
  defaultHookPoint?: WorkflowHookPoint;
}): Promise<WorkflowHandoffHookGateResult> {
  const payload = params.intent.payload ?? {};
  const hookGatePoint =
    (readString(payload.hookGatePoint) as WorkflowHookPoint | null) ??
    params.defaultHookPoint ??
    "before_stage_handoff";
  const storedFingerprint = readString(payload.hookGateFingerprint);
  if (!storedFingerprint) {
    const policy = await readWorkflowHooksPolicyForProject(params.intent.projectRoot).catch(
      () => null
    );
    const matchingDeliveryHooks =
      policy?.auditHooks.filter(
        (hook) =>
          hook.enabled &&
          hook.hookPoint === hookGatePoint &&
          (!hook.stage || hook.stage === (params.intent.stageAfter ?? params.intent.stage))
      ) ?? [];
    if (matchingDeliveryHooks.length > 0) {
      return {
        allowed: false,
        hookPoint: hookGatePoint,
        aggregateVerdict: null,
        aggregateStatus: "missing",
        blockingReason:
          "Handoff predates the required hook gate for this delivery point.",
        aggregateRevisionPacketPath: null,
        hookGate: null,
      };
    }
    return {
      allowed: true,
      hookPoint: hookGatePoint,
      aggregateVerdict: "pass",
      aggregateStatus: "legacy_unchecked",
      blockingReason: null,
      aggregateRevisionPacketPath: null,
      hookGate: null,
    };
  }

  const [store, policy] = await Promise.all([
    readWorkflowHooksStateStore(params.intent.projectRoot).catch(() => null),
    readWorkflowHooksPolicyForProject(params.intent.projectRoot).catch(() => null),
  ]);
  const key = buildWorkflowHookAggregateKey({
    hookPoint: hookGatePoint,
    stage: params.intent.stageAfter ?? params.intent.stage,
  });
  const aggregate = store?.hookPoints[key.hookPoint]?.[key.stage] ?? null;
  const policyIds =
    policy?.auditHooks
      .filter(
        (hook) =>
          hook.enabled &&
          hook.hookPoint === hookGatePoint &&
          (!hook.stage || hook.stage === (params.intent.stageAfter ?? params.intent.stage))
      )
      .map((hook) => hook.hookId) ?? [];
  const currentFingerprint = buildWorkflowHandoffHookGateFingerprint({
    projectRoot: params.intent.projectRoot,
    projectId: params.intent.projectId,
    hookPoint: hookGatePoint,
    stage: params.intent.stageAfter ?? params.intent.stage,
    ownerBefore: params.intent.fromRole,
    ownerAfter: params.intent.toRole,
    aggregateVerdict: aggregate?.aggregateVerdict ?? null,
    aggregateStatus: aggregate?.aggregateStatus ?? null,
    aggregateRevisionPacketPath: aggregate?.aggregateRevisionPacketPath ?? null,
    hookGatePolicyIds:
      policyIds.length > 0
        ? policyIds
        : Array.isArray(payload.hookGatePolicyIds)
          ? payload.hookGatePolicyIds.filter((entry): entry is string => typeof entry === "string")
          : [],
  });
  const nonBlockingDebtOrWarning =
    aggregate?.gateControl &&
    !aggregate.gateControl.blocking &&
    aggregate.gateControl.repairRequiredCount === 0 &&
    (aggregate.gateControl.deferredDebtCount > 0 ||
      aggregate.gateControl.warnOnlyCount > 0);
  const allowed =
    storedFingerprint === currentFingerprint &&
    (aggregate?.aggregateVerdict == null ||
      aggregate.aggregateVerdict === "pass" ||
      Boolean(nonBlockingDebtOrWarning));
  return {
    allowed,
    hookPoint: hookGatePoint,
    aggregateVerdict: aggregate?.aggregateVerdict ?? null,
    aggregateStatus: aggregate?.aggregateStatus ?? "missing",
    blockingReason: allowed
      ? null
      : "Handoff hook gate is stale or no longer passing.",
    aggregateRevisionPacketPath: aggregate?.aggregateRevisionPacketPath ?? null,
    gateControl: aggregate?.gateControl ?? null,
    hookGate: {
      hookGatePoint,
      hookGateFingerprint: currentFingerprint,
      hookGateVerdict: aggregate?.aggregateVerdict ?? null,
      hookGateStatus: aggregate?.aggregateStatus ?? "missing",
      hookGateCheckedAt: nowIso(),
      hookGatePolicyIds:
        policyIds.length > 0
          ? policyIds
          : Array.isArray(payload.hookGatePolicyIds)
            ? payload.hookGatePolicyIds.filter((entry): entry is string => typeof entry === "string")
            : [],
      hookGateRevisionPacketPath: aggregate?.aggregateRevisionPacketPath ?? null,
    },
  };
}
