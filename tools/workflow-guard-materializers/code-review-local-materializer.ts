import * as path from "node:path";
import type { WorkflowAutoGateConfig } from "../workflow-auto-mode.js";
import { DEFAULT_WORKFLOW_AUTO_GATE } from "../workflow-auto-mode.js";
import {
  aggregateCodeReviewRound,
  buildLocalCodeReviewAttempts,
  createCodeReviewRound,
  defaultCodeReviewPanel,
  materializeCodeReviewPacket,
  readCodeReviewStore,
  saveCodeReviewStore,
  type CodeReviewRound,
} from "../workflow-code-review.js";
import { appendWorkflowDiagnosticEvent } from "../workflow-diagnostics.js";
import { syncBuiltinAutoCodeReviewHook } from "../workflow-hooks/builtin-bridge.js";
import { recordWorkflowReviewRoundResults } from "../workflow-handoff/review-rounds";
import { readJsonIfExists } from "../workflow-guard-core/fs";

type ManifestLike = Record<string, unknown>;

export type LocalCodeReviewMaterializationResult = {
  materialized: boolean;
  reason: string;
  status: CodeReviewRound["status"] | null;
  approved: boolean;
  packetFingerprint: string | null;
  reviewCount: number;
  generatedFiles: string[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseFallbackAfterMs(): number | null {
  const raw = process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS;
  if (raw == null || raw.trim().length === 0) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function earliestAttemptLaunchMs(round: CodeReviewRound | null): number | null {
  if (!round) {
    return null;
  }
  const timestamps = [
    round.launchedAt,
    ...round.attempts.map((attempt) => attempt.launchedAt),
  ]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

function shouldUseLocalReview(params: {
  round: CodeReviewRound | null;
  packetFingerprint: string;
  fallbackAfterMs: number;
  nowMs: number;
}): { useLocal: boolean; reason: string } {
  const round = params.round;
  if (!round || round.packetFingerprint !== params.packetFingerprint) {
    return params.fallbackAfterMs === 0
      ? { useLocal: true, reason: "local_static_review_no_runtime_round" }
      : { useLocal: false, reason: "runtime_review_not_started" };
  }
  if (round.status === "approved") {
    return { useLocal: false, reason: "already_approved" };
  }
  if (round.status === "rejected") {
    return { useLocal: false, reason: "already_rejected" };
  }
  if (params.fallbackAfterMs === 0) {
    return { useLocal: true, reason: "local_static_review_forced" };
  }
  const launchedAtMs = earliestAttemptLaunchMs(round);
  if (launchedAtMs !== null && params.nowMs - launchedAtMs >= params.fallbackAfterMs) {
    return { useLocal: true, reason: "local_static_review_runtime_stale" };
  }
  return { useLocal: false, reason: "runtime_review_waiting" };
}

function inferProjectId(params: {
  projectRoot: string;
  manifest: ManifestLike;
  explicitProjectId?: string | null;
}): string | null {
  return (
    readString(params.explicitProjectId) ??
    readString(params.manifest.project_id ?? params.manifest.projectId) ??
    path.basename(params.projectRoot)
  );
}

export async function materializeLocalCodeReviewFallback(params: {
  projectRoot: string;
  projectId?: string | null;
  autoGate?: WorkflowAutoGateConfig | null;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<LocalCodeReviewMaterializationResult> {
  const fallbackAfterMs = parseFallbackAfterMs();
  if (fallbackAfterMs === null) {
    return {
      materialized: false,
      reason: "local_static_review_env_disabled",
      status: null,
      approved: false,
      packetFingerprint: null,
      reviewCount: 0,
      generatedFiles: [],
    };
  }

  const manifest =
    (await readJsonIfExists<ManifestLike>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId = inferProjectId({
    projectRoot: params.projectRoot,
    manifest,
    explicitProjectId: params.projectId,
  });
  const packet = await materializeCodeReviewPacket({
    projectRoot: params.projectRoot,
    projectId,
  });
  const store = await readCodeReviewStore(params.projectRoot);
  const decision = shouldUseLocalReview({
    round: store.currentRound,
    packetFingerprint: packet.packetFingerprint,
    fallbackAfterMs,
    nowMs: Date.now(),
  });
  if (!decision.useLocal) {
    await appendWorkflowDiagnosticEvent({
      projectRoot: params.projectRoot,
      projectId,
      component: "stage_preflight",
      action: "local_static_code_review_skipped",
      status: "waiting",
      stage: "code",
      owner: "reviewer",
      summary: "Local static CODE review fallback did not run.",
      details: {
        reason: decision.reason,
        trigger: params.trigger ?? null,
        packetFingerprint: packet.packetFingerprint,
      },
    });
    return {
      materialized: false,
      reason: decision.reason,
      status: store.currentRound?.status ?? null,
      approved: store.currentRound?.status === "approved",
      packetFingerprint: packet.packetFingerprint,
      reviewCount: store.currentRound?.aggregate?.reviewCount ?? 0,
      generatedFiles: [],
    };
  }

  const autoGate = params.autoGate ?? DEFAULT_WORKFLOW_AUTO_GATE;
  const attempts = buildLocalCodeReviewAttempts({
    packet: packet.packet,
    packetFingerprint: packet.packetFingerprint,
    participants: defaultCodeReviewPanel(),
    reason: decision.reason,
  });
  const round = createCodeReviewRound({
    stage: "code",
    packetPath: packet.packetPath,
    packetJsonPath: packet.packetJsonPath,
    packetFingerprint: packet.packetFingerprint,
    attempts,
  });
  round.aggregate = aggregateCodeReviewRound(round, autoGate);
  round.status = round.aggregate.status;
  await saveCodeReviewStore(params.projectRoot, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    roundsStarted:
      store.currentRound?.packetFingerprint === packet.packetFingerprint
        ? store.roundsStarted
        : store.roundsStarted + 1,
    currentRound: round,
  });

  await recordWorkflowReviewRoundResults({
    projectRoot: params.projectRoot,
    projectId,
    workflowLine: "experiment",
    stage: "code",
    results: round.attempts
      .filter((attempt) => attempt.result)
      .map((attempt) => ({
        reviewerRole: attempt.reviewerRole,
        verdict:
          attempt.result?.verdict === "pass"
            ? "pass"
            : attempt.result?.verdict === "revise"
              ? "revise"
              : "block",
        summary:
          attempt.result?.summary ??
          `${attempt.reviewerRole} local code review ${attempt.result?.verdict ?? attempt.status}.`,
        artifactPaths: attempt.result?.reviewedArtifacts ?? [],
        blockers: [
          ...(attempt.result?.criticalBlockers ?? []),
          ...(attempt.result?.majorIssues ?? []),
        ],
      })),
    nextOwnerOnPass: null,
  });
  await syncBuiltinAutoCodeReviewHook({
    projectRoot: params.projectRoot,
    stage: "code",
    attempt: {
      reason: decision.reason,
      status: round.status,
      approved: round.aggregate.approved,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId,
    component: "stage_preflight",
    action: "local_static_code_review_completed",
    status: round.aggregate.approved ? "completed" : "blocked",
    stage: "code",
    owner: "reviewer",
    summary: round.aggregate.approved
      ? "Local static CODE review approved the code packet."
      : "Local static CODE review rejected the code packet.",
    details: {
      reason: decision.reason,
      trigger: params.trigger ?? null,
      agentId: params.agentId ?? null,
      packetFingerprint: packet.packetFingerprint,
      reviewCount: round.aggregate.reviewCount,
      averageScore: round.aggregate.averageScore,
      blockerCount: round.aggregate.blockerCount,
    },
  });

  return {
    materialized: true,
    reason: decision.reason,
    status: round.status,
    approved: round.aggregate.approved,
    packetFingerprint: packet.packetFingerprint,
    reviewCount: round.aggregate.reviewCount,
    generatedFiles: [
      "reviewer/code-review/CODE_REVIEW_PACKET.md",
      "reviewer/code-review/CODE_REVIEW_PACKET.json",
      ".openclaw-research/code-review-state.json",
      ".openclaw-research/authoring-artifact-receipts.json",
    ],
  };
}
