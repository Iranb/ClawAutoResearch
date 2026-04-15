import path from "node:path";

import { readJsonIfExists } from "../workflow-guard-core/fs";
import { summarizeEvidenceCloseoutState } from "../workflow-evidence/closeout-summary";
import {
  normalizeAblationEvidenceState,
  normalizeBenchmarkProtocolState,
  normalizeCameraReadyEvidenceState,
  normalizeMechanismEvidenceState,
  normalizeReproducibilityPackState,
  normalizeStatisticalEvidenceState,
  normalizeVenueCompetitionState,
} from "../workflow-evidence/contracts";
import {
  claimNextWorkflowTaskForOwner,
  completeWorkflowTask,
  markWorkflowTaskNeedsRepair,
  markWorkflowTaskVerifying,
  readWorkflowTaskGraphStore,
  type WorkflowTaskGraphTask,
} from "./task-graph";
import {
  materializeWorkflowTeamRound,
  readWorkflowTeamRoundStore,
  recordWorkflowTeamRoundClaim,
  recordWorkflowTeamRoundCompletion,
} from "./team-round";
import { getWorkflowTaskGraphPath, summarizeWorkflowTaskGraphStore } from "./task-graph";

type ManifestLike = Record<string, unknown>;

export type WorkflowTaskVerificationResult = {
  verified: boolean;
  reason: string | null;
};

function isReadyLike(value: string | null | undefined): boolean {
  return ["ready", "pass", "complete", "completed", "sufficient", "strong"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

export async function verifyWorkflowTaskCompletion(params: {
  projectRoot: string;
  task: WorkflowTaskGraphTask;
}): Promise<WorkflowTaskVerificationResult> {
  if (params.task.verificationRule === "none") {
    return { verified: true, reason: null };
  }

  const manifest =
    (await readJsonIfExists<ManifestLike>(path.join(params.projectRoot, "PROJECT_MANIFEST.json"))) ??
    {};
  const evidenceCloseout = summarizeEvidenceCloseoutState(manifest);
  const benchmarkProtocol = normalizeBenchmarkProtocolState(
    manifest.benchmark_protocol ?? manifest.benchmarkProtocol
  );
  const statisticalEvidence = normalizeStatisticalEvidenceState(
    manifest.statistical_evidence ?? manifest.statisticalEvidence
  );
  const ablationEvidence = normalizeAblationEvidenceState(
    manifest.ablation_evidence ?? manifest.ablationEvidence
  );
  const mechanismEvidence = normalizeMechanismEvidenceState(
    manifest.mechanism_evidence ?? manifest.mechanismEvidence
  );
  const venueCompetition = normalizeVenueCompetitionState(
    manifest.venue_competition ?? manifest.venueCompetition
  );
  const reproducibilityPack = normalizeReproducibilityPackState(
    manifest.reproducibility_pack ?? manifest.reproducibilityPack
  );
  const cameraReadyEvidence = normalizeCameraReadyEvidenceState(
    manifest.camera_ready_evidence ?? manifest.cameraReadyEvidence
  );

  switch (params.task.verificationRule) {
    case "benchmark_protocol":
      return benchmarkProtocol.status !== "missing" &&
        benchmarkProtocol.locked &&
        benchmarkProtocol.driftStatus !== "fail"
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              benchmarkProtocol.pendingReason ??
              "Benchmark protocol is not locked and drift-free yet.",
          };
    case "statistical_evidence":
      return statisticalEvidence.status !== "missing" &&
        Boolean(statisticalEvidence.claimStrengthStatus)
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              statisticalEvidence.pendingReason ??
              "Statistical evidence is still missing an aggregate or claim-strength verdict.",
          };
    case "ablation_evidence":
      return ablationEvidence.status !== "missing" &&
        Boolean(ablationEvidence.sufficiencyStatus)
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              ablationEvidence.pendingReason ??
              "Ablation evidence is still missing a sufficiency verdict.",
          };
    case "mechanism_evidence":
      return mechanismEvidence.status !== "missing" &&
        !["graph_unavailable", "unverified_graph_context"].includes(
          mechanismEvidence.graphContextStatus ?? ""
        )
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              mechanismEvidence.pendingReason ??
              "Mechanism evidence is not graph-grounded yet.",
          };
    case "venue_competition":
      return venueCompetition.status !== "missing" &&
        !["graph_unavailable", "unverified_graph_context"].includes(
          venueCompetition.graphContextStatus ?? ""
        )
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              venueCompetition.pendingReason ??
              "Venue competition is not graph-grounded yet.",
          };
    case "reproducibility_pack":
      return reproducibilityPack.status !== "missing" &&
        Boolean(reproducibilityPack.environmentCaptureStatus)
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              reproducibilityPack.pendingReason ??
              "Reproducibility pack is still incomplete.",
          };
    case "camera_ready_evidence":
      return cameraReadyEvidence.status !== "missing" &&
        isReadyLike(cameraReadyEvidence.figuresStatus) &&
        isReadyLike(cameraReadyEvidence.tablesStatus) &&
        isReadyLike(cameraReadyEvidence.captionsStatus)
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              cameraReadyEvidence.pendingReason ??
              "Camera-ready evidence is still incomplete.",
          };
    case "write_closeout":
      return evidenceCloseout.writeReady
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              evidenceCloseout.blockers[0] ??
              "Write closeout requirements are still blocked.",
          };
    case "submit_closeout":
      return evidenceCloseout.submitReady && evidenceCloseout.status === "ready"
        ? { verified: true, reason: null }
        : {
            verified: false,
            reason:
              evidenceCloseout.blockers[0] ??
              "Submit closeout requirements are still blocked.",
          };
    default:
      return { verified: true, reason: null };
  }
}

export async function completeWorkflowTaskAndContinue(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
  role: string;
  completionNote?: string | null;
  ttlMs?: number;
  beforeCompleteHook?: (params: {
    projectRoot: string;
    task: WorkflowTaskGraphTask;
    sessionKey: string;
    role: string;
  }) => Promise<{ allow: boolean; reason?: string | null }>;
}): Promise<{
  completed: boolean;
  task: WorkflowTaskGraphTask | null;
  nextTask: WorkflowTaskGraphTask | null;
  verification: WorkflowTaskVerificationResult;
}> {
  const store = await readWorkflowTaskGraphStore(params.projectRoot);
  const task = store?.tasks.find((entry) => entry.taskId === params.taskId) ?? null;
  if (!task) {
    return {
      completed: false,
      task: null,
      nextTask: null,
      verification: { verified: false, reason: "task_missing" },
    };
  }

  await markWorkflowTaskVerifying({
    projectRoot: params.projectRoot,
    taskId: params.taskId,
    sessionKey: params.sessionKey,
  });
  const verification = await verifyWorkflowTaskCompletion({
    projectRoot: params.projectRoot,
    task,
  });
  if (!verification.verified) {
    const failed = await markWorkflowTaskNeedsRepair({
      projectRoot: params.projectRoot,
      taskId: params.taskId,
      sessionKey: params.sessionKey,
      reason: verification.reason,
    });
    return {
      completed: false,
      task: failed.task,
      nextTask: null,
      verification,
    };
  }
  if (params.beforeCompleteHook) {
    const hookGate = await params.beforeCompleteHook({
      projectRoot: params.projectRoot,
      task,
      sessionKey: params.sessionKey,
      role: params.role,
    });
    if (!hookGate.allow) {
      const failed = await markWorkflowTaskNeedsRepair({
        projectRoot: params.projectRoot,
        taskId: params.taskId,
        sessionKey: params.sessionKey,
        reason: hookGate.reason ?? "Workflow hook blocked task completion.",
      });
      return {
        completed: false,
        task: failed.task,
        nextTask: null,
        verification: {
          verified: false,
          reason: hookGate.reason ?? "workflow_hook_blocked",
        },
      };
    }
  }

  const completed = await completeWorkflowTask({
    projectRoot: params.projectRoot,
    taskId: params.taskId,
    sessionKey: params.sessionKey,
    role: params.role,
    completionNote: params.completionNote,
  });
  if (!completed.completed || !completed.task) {
    return {
      completed: false,
      task: completed.task,
      nextTask: null,
      verification: {
        verified: false,
        reason: completed.reason ?? "task_completion_failed",
      },
    };
  }

  await recordWorkflowTeamRoundCompletion({
    projectRoot: params.projectRoot,
    sessionKey: params.sessionKey,
    taskId: params.taskId,
  });

  const nextTask = await claimNextWorkflowTaskForOwner({
    projectRoot: params.projectRoot,
    owner: params.role,
    sessionKey: params.sessionKey,
    ttlMs: params.ttlMs,
  });

  if (nextTask.claimed && nextTask.task) {
    const updatedGraph = await readWorkflowTaskGraphStore(params.projectRoot);
    const summary = summarizeWorkflowTaskGraphStore(updatedGraph);
    const existingRound = await readWorkflowTeamRoundStore(params.projectRoot);
    if (updatedGraph) {
      await materializeWorkflowTeamRound({
        projectRoot: params.projectRoot,
        projectId: existingRound?.projectId ?? updatedGraph.projectId,
        stage: existingRound?.stage ?? updatedGraph.stage,
        leadRole: existingRound?.leadRole ?? params.role,
        topTierVerdict: existingRound?.topTierVerdict ?? updatedGraph.topTierVerdict,
        evidenceCloseoutStatus:
          existingRound?.evidenceCloseoutStatus ?? updatedGraph.evidenceCloseoutStatus,
        taskGraphPath: getWorkflowTaskGraphPath(params.projectRoot),
        taskCount: summary.taskCount,
        claimableCount: summary.claimableCount,
        blockedCount: summary.blockedCount,
        claimedCount: summary.claimedCount,
        verifyingCount: summary.verifyingCount,
        needsRepairCount: summary.needsRepairCount,
        satisfiedCount: summary.satisfiedCount,
        optionalCount: summary.optionalCount,
      });
      await recordWorkflowTeamRoundClaim({
        projectRoot: params.projectRoot,
        sessionKey: params.sessionKey,
        taskId: nextTask.task.taskId,
      });
    }
  }

  return {
    completed: true,
    task: completed.task,
    nextTask: nextTask.task,
    verification,
  };
}
