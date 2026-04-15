import { createHash } from "node:crypto";
import path from "node:path";
import { deriveAgentSessionKeyForRole } from "../agent-task-dispatch";
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
import { evaluateWorkflowHooksForPoint } from "./executor.js";
import { buildWorkflowHookPointContext } from "./point-context.js";
import type {
  WorkflowHookPoint,
  WorkflowHookPointExecutionSummary,
  WorkflowLine,
  WorkflowPaperMode,
} from "./contracts.js";
import type { RuntimeSubagentApi } from "./runtime-review-loop.js";

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
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  return {
    workflowLine:
      readString(manifest.workflow_line) === "survey" ||
      readString(manifest.paper_type) === "survey" ||
      writingContract.paperMode === "survey" ||
      readString(manifest.current_stage) === "survey_review"
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
  runtimeSubagent?: RuntimeSubagentApi;
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
    runtimeSubagent: params.runtimeSubagent,
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
      params.runtimeSubagent?.run != null
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
              const started = await params.runtimeSubagent!.run!({
                sessionKey,
                message: launchParams.message,
                lane: "nested",
                deliver: false,
                idempotencyKey: launchParams.idempotencyKey,
                extraSystemPrompt:
                  "Workflow handoff hook reviewer.\n" +
                  "Audit only the supplied handoff gate packet and return the required JSON schema.",
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
  const hookGate = buildWorkflowHandoffHookGateRecord({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    hookPoint: params.hookPoint,
    stage: params.stage,
    ownerBefore: params.ownerBefore,
    ownerAfter: params.ownerAfter,
    summary,
  });
  const allowed =
    summary.hooksRun.length === 0 || summary.aggregateVerdict === "pass";
  return {
    allowed,
    hookPoint: params.hookPoint,
    aggregateVerdict: summary.aggregateVerdict,
    aggregateStatus: summary.aggregateStatus,
    blockingReason: summary.blockingReason,
    aggregateRevisionPacketPath: summary.aggregateRevisionPacketPath,
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
  const allowed =
    storedFingerprint === currentFingerprint &&
    (aggregate?.aggregateVerdict == null || aggregate.aggregateVerdict === "pass");
  return {
    allowed,
    hookPoint: hookGatePoint,
    aggregateVerdict: aggregate?.aggregateVerdict ?? null,
    aggregateStatus: aggregate?.aggregateStatus ?? "missing",
    blockingReason: allowed
      ? null
      : "Handoff hook gate is stale or no longer passing.",
    aggregateRevisionPacketPath: aggregate?.aggregateRevisionPacketPath ?? null,
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
