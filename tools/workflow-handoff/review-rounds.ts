import { randomUUID } from "node:crypto";
import {
  buildBuiltinReviewRoundHookId,
  syncBuiltinReviewRoundHook,
  writeBuiltinWorkflowHookState,
} from "../workflow-hooks/builtin-bridge.js";
import { createWorkflowArtifactReceipt } from "./artifact-receipts";
import { routeWorkflowFailure } from "./failure-router";
import { upsertWorkflowHandoffIntent } from "./handoff-store";
import type { WorkflowHandoffIntent } from "./handoff-types";

export type WorkflowReviewRoundVerdict = "pass" | "revise" | "block";

export type WorkflowReviewRoundResult = {
  reviewerRole: string;
  verdict: WorkflowReviewRoundVerdict;
  summary: string;
  artifactPaths?: string[];
  blockers?: string[];
};

export async function createWorkflowReviewRoundHandoff(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  stage?: string | null;
  fromRole?: string | null;
  reviewerRole: string;
  subject: string;
  command?: string | null;
}): Promise<{ intent: WorkflowHandoffIntent; created: boolean }> {
  const handoff = await upsertWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    workflowLine: params.workflowLine ?? "experiment",
    idempotencyKey: [
      "review_round",
      params.projectId ?? "unknown-project",
      params.stage ?? "unknown-stage",
      params.reviewerRole,
      params.subject,
    ].join(":"),
    stage: params.stage,
    fromRole: params.fromRole,
    toRole: params.reviewerRole,
    reason: params.stage === "code" ? "code_review_required" : "paper_review_required",
    priority: "high",
    summary: params.subject,
    command: params.command,
  });
  await writeBuiltinWorkflowHookState({
    projectRoot: params.projectRoot,
    hookId: buildBuiltinReviewRoundHookId({
      workflowLine: params.workflowLine,
      stage: params.stage,
    }),
    hookPoint: "before_stage_handoff",
    stage: params.stage ?? null,
    status: "auditing",
    verdict: null,
    blockingReason: "Workflow review round is still pending.",
  });
  return handoff;
}

export async function recordWorkflowReviewRoundResults(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  stage?: string | null;
  handoffIntentId?: string | null;
  results: WorkflowReviewRoundResult[];
  repairOwnerForRevise?: string | null;
  nextOwnerOnPass?: string | null;
}): Promise<{
  receipts: Awaited<ReturnType<typeof createWorkflowArtifactReceipt>>[];
  aggregateVerdict: WorkflowReviewRoundVerdict;
  nextHandoff: WorkflowHandoffIntent | null;
}> {
  const receipts = [];
  let aggregateVerdict: WorkflowReviewRoundVerdict = "pass";
  for (const result of params.results) {
    if (result.verdict === "block") {
      aggregateVerdict = "block";
    } else if (result.verdict === "revise" && aggregateVerdict === "pass") {
      aggregateVerdict = "revise";
    }
    receipts.push(
      await createWorkflowArtifactReceipt({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        handoffIntentId: params.handoffIntentId,
        producedByRole: result.reviewerRole,
        stage: params.stage,
        summary: result.summary,
        artifactPaths: result.artifactPaths,
        verificationResult: result.verdict === "pass" ? "passed" : "failed",
        blockers: result.blockers,
      })
    );
  }
  const aggregateSummary =
    params.results.map((entry) => entry.summary).filter(Boolean).join(" ") || null;
  await syncBuiltinReviewRoundHook({
    projectRoot: params.projectRoot,
    workflowLine: params.workflowLine,
    stage: params.stage ?? null,
    aggregateVerdict,
    summary: aggregateSummary,
  });

  if (aggregateVerdict === "pass" && params.nextOwnerOnPass) {
    const handoff = await upsertWorkflowHandoffIntent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      workflowLine: params.workflowLine ?? "experiment",
      idempotencyKey: [
        "review_pass",
        params.projectId ?? "unknown-project",
        params.stage ?? "unknown-stage",
        params.nextOwnerOnPass,
        randomUUID(),
      ].join(":"),
      stage: params.stage,
      fromRole: "reviewer",
      toRole: params.nextOwnerOnPass,
      reason: "task_completed",
      priority: "normal",
      summary: "Review round passed; next owner can continue.",
    });
    return { receipts, aggregateVerdict, nextHandoff: handoff.intent };
  }

  if (aggregateVerdict !== "pass") {
    const failure = await routeWorkflowFailure({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      workflowLine: params.workflowLine ?? "experiment",
      stage: params.stage,
      originalOwner: "reviewer",
      failureKind: aggregateVerdict === "block" ? "code_review_failed" : "plan_inconsistent",
      failureReason: params.results
        .flatMap((entry) => entry.blockers ?? [])
        .join("; ") || `Review round returned ${aggregateVerdict}.`,
    });
    return { receipts, aggregateVerdict, nextHandoff: failure.handoff };
  }

  return { receipts, aggregateVerdict, nextHandoff: null };
}
