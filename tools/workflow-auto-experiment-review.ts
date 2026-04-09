import * as path from "node:path";
import { createHash } from "node:crypto";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import {
  DEFAULT_EXPERIMENT_REVIEW_STATE_PATH,
  isExperimentReviewCompleted,
  normalizeAutonomousExecutionState,
  normalizeExperimentReviewState,
  serializeExperimentReviewState,
  type AutonomousExecutionStateLike,
  type ExperimentReviewStateLike,
} from "./workflow-guard-state/experiment-review";

export function isReviewedAutoExperimentLaunchEnabled(
  autonomousExecution: unknown
): boolean {
  return (
    normalizeAutonomousExecutionState(autonomousExecution).experimentLaunchMode ===
    "reviewed_auto"
  );
}

export function getExperimentReviewStatePath(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_EXPERIMENT_REVIEW_STATE_PATH);
}

export async function loadExperimentReviewState(params: {
  projectRoot: string;
  manifest: Record<string, unknown> | null;
}): Promise<ExperimentReviewStateLike> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getExperimentReviewStatePath(params.projectRoot)
  );
  if (raw) {
    return normalizeExperimentReviewState(raw);
  }
  return normalizeExperimentReviewState(params.manifest?.experiment_review_state);
}

export async function saveExperimentReviewStateFile(params: {
  projectRoot: string;
  state: ExperimentReviewStateLike;
}): Promise<void> {
  await writeJsonEnsured(
    getExperimentReviewStatePath(params.projectRoot),
    serializeExperimentReviewState(params.state)
  );
}

export function buildExperimentReviewPacketFingerprint(params: {
  trackIds: string[];
  claimIds: string[];
  graphPacketPaths: string[];
  packet: Record<string, unknown>;
}): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        trackIds: [...params.trackIds].sort(),
        claimIds: [...params.claimIds].sort(),
        graphPacketPaths: [...params.graphPacketPaths].sort(),
        packet: params.packet,
      })
    )
    .digest("hex");
}

export function buildExperimentReviewSummary(state: ExperimentReviewStateLike): string {
  const bits = [
    `status=${state.status}`,
    `micro_stage=${state.microStage ?? "unknown"}`,
    `round=${state.reviewRound}`,
    `planner=${state.plannerStatus}`,
    `analyzer=${state.analyzerStatus}`,
    `cross=${state.crossReviewerStatus}`,
    `launch=${state.launchApproved ? "approved" : "pending"}`,
  ];
  if (state.blockerCount > 0) {
    bits.push(`blockers=${state.blockerCount}`);
  }
  return bits.join(", ");
}

export function resolveExperimentReviewNextOwner(params: {
  state: ExperimentReviewStateLike;
  autonomousExecution: AutonomousExecutionStateLike;
  hasActiveRuns: boolean;
  readyForAnalysis: boolean;
}): "researcher" | "planner" | "analyzer" | "cross-reviewer" | "coder" | null {
  if (
    params.autonomousExecution.experimentLaunchMode !== "reviewed_auto" ||
    params.readyForAnalysis ||
    params.hasActiveRuns
  ) {
    return null;
  }
  if (!isExperimentReviewCompleted({ status: params.state.plannerStatus })) {
    return "planner";
  }
  if (
    params.autonomousExecution.requireAnalyzerReview &&
    !isExperimentReviewCompleted({
      status: params.state.analyzerStatus,
      verdict: params.state.analyzerVerdict,
    })
  ) {
    return "analyzer";
  }
  if (
    params.autonomousExecution.requireCrossReview &&
    !isExperimentReviewCompleted({
      status: params.state.crossReviewerStatus,
      verdict: params.state.crossReviewerVerdict,
    })
  ) {
    return "cross-reviewer";
  }
  if (params.state.launchApproved) {
    return "coder";
  }
  return "researcher";
}

export function buildExperimentReviewCommand(params: {
  owner: "researcher" | "planner" | "analyzer" | "cross-reviewer" | "coder" | null;
  state: ExperimentReviewStateLike;
}): string | null {
  switch (params.owner) {
    case "planner":
      return "Run /experiment-plan to assemble or refresh planner/EXPERIMENT_REVIEW_PACKET.json, planner/EXPERIMENT_PLAN.md, falsifiers, stop rules, compute budget, and claim-to-experiment coverage before reviewer launch.";
    case "analyzer":
      return "Run /experiment-design-review to audit causal attribution, baseline fairness, metric sufficiency, compute realism, and claim coverage, then persist analyzer/EXPERIMENT_REASONABLENESS_REPORT.md plus experiment_review_state.analyzer_* fields.";
    case "cross-reviewer":
      return "Run /experiment-attack to independently stress-test novelty, confounds, falsifiers, rollback triggers, and overclaim risk, then persist cross-reviewer/EXPERIMENT_ATTACK_REPORT.md plus experiment_review_state.cross_reviewer_* fields.";
    case "researcher":
      return "Review planner/analyzer/cross-reviewer findings, revise the packet if needed, and update researcher/EXPERIMENT_LAUNCH_DECISION.json plus experiment_review_state.launch_approved only when the bundle is truly ready.";
    case "coder":
      return "Run /run-experiment only against the approved planner packet, keep the launch bounded to the reviewed bundle, and persist launch metadata before monitor mode takes over.";
    default:
      return null;
  }
}

export function deriveExperimentReviewMicroStage(params: {
  state: ExperimentReviewStateLike;
  autonomousExecution: AutonomousExecutionStateLike;
  hasActiveRuns: boolean;
  readyForAnalysis: boolean;
}): string | null {
  if (params.readyForAnalysis) {
    return "ready_for_analysis";
  }
  if (params.hasActiveRuns) {
    return "monitoring";
  }
  if (params.autonomousExecution.experimentLaunchMode !== "reviewed_auto") {
    return params.state.microStage;
  }
  if (!isExperimentReviewCompleted({ status: params.state.plannerStatus })) {
    return "planning";
  }
  if (
    params.autonomousExecution.requireAnalyzerReview &&
    !isExperimentReviewCompleted({
      status: params.state.analyzerStatus,
      verdict: params.state.analyzerVerdict,
    })
  ) {
    return "analyzer_review";
  }
  if (
    params.autonomousExecution.requireCrossReview &&
    !isExperimentReviewCompleted({
      status: params.state.crossReviewerStatus,
      verdict: params.state.crossReviewerVerdict,
    })
  ) {
    return "cross_review";
  }
  if (params.state.launchApproved) {
    return "launching";
  }
  return "synthesis";
}
