import * as path from "node:path";

import { evaluatePaperGuruGate } from "./autoresearch-loop-state";
import { assembleWritePackage } from "./workflow-guard";
import { asString } from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import { materializeAnalysisArtifactsImpl } from "./workflow-guard-materializers/analysis-artifacts-materializer";
import { materializeWorkflowFinalScorecard } from "./workflow-final-scorecard";
import type { WorkflowControlContract } from "./workflow-control-contract";
import { reconcileWorkflowControl } from "./workflow-control-reconciler";
import {
  resolveWorkflowStageCompletion,
  type StageCompletion,
} from "./workflow-stage-completion";

export type LateStageClosureSmokeStepStatus = "pass" | "blocked" | "failed";

export type LateStageClosureSmokeStep = {
  status: LateStageClosureSmokeStepStatus;
  blocking_reason: string | null;
  blockers: string[];
  details: Record<string, unknown>;
};

export type LateStageClosureSmokeReport = {
  schema_version: "late-stage-closure-smoke-v1";
  generated_at: string;
  status: LateStageClosureSmokeStepStatus;
  first_blocker_stage: string | null;
  project_id: string | null;
  authority: {
    canonical_completion_source: "PROJECT_MANIFEST.json.workflow_control";
    smoke_is_completion_authority: false;
    smoke_purpose: "derived_diagnostic";
  };
  canonical_before: ReturnType<typeof summarizeWorkflowControl>;
  canonical_after: ReturnType<typeof summarizeWorkflowControl>;
  steps: {
    analysis_artifacts: LateStageClosureSmokeStep;
    write_package: LateStageClosureSmokeStep;
    paperguru: LateStageClosureSmokeStep;
    final_scorecard: LateStageClosureSmokeStep;
  };
  blockers: string[];
  artifact_paths: {
    smoke_path: string;
    final_scorecard_path: string | null;
  };
};

export type MaterializeLateStageClosureSmokeResult = {
  materialized: true;
  status: LateStageClosureSmokeStepStatus;
  firstBlockerStage: string | null;
  smokePath: string;
  report: LateStageClosureSmokeReport;
};

type CapturedResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: unknown;
    };

const LATE_STAGE_SMOKE_RELATIVE_PATH =
  ".openclaw-research/LATE_STAGE_CLOSURE_SMOKE.json";

async function capture<T>(promise: Promise<T>): Promise<CapturedResult<T>> {
  try {
    return {
      ok: true,
      value: await promise,
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function summarizeWorkflowControl(contract: WorkflowControlContract) {
  return {
    contract_id: contract.contract_id,
    stage: contract.stage,
    owner: contract.owner,
    next_action: contract.next_action,
    status: contract.status,
    blocking_reason: contract.blocking_reason,
    completion_status: contract.completion.status,
    completion_source: contract.completion.source,
    runtime_state: contract.runtime_state,
  };
}

function completionStep(params: {
  completion: StageCompletion;
  details?: Record<string, unknown>;
}): LateStageClosureSmokeStep {
  const blockers = uniqueStrings([
    params.completion.blockingReason ?? "",
    ...(params.completion.missingSignals ?? []),
  ]);
  return {
    status:
      params.completion.completionStatus === "complete"
        ? "pass"
        : params.completion.completionStatus === "failed"
          ? "failed"
          : "blocked",
    blocking_reason: params.completion.blockingReason ?? blockers[0] ?? null,
    blockers,
    details: {
      completion_status: params.completion.completionStatus,
      owner: params.completion.owner ?? null,
      next_action: params.completion.nextAction ?? null,
      contract_source: params.completion.contractSource,
      ...(params.details ?? {}),
    },
  };
}

function failedStep(error: unknown): LateStageClosureSmokeStep {
  const message = errorMessage(error);
  return {
    status: "failed",
    blocking_reason: message,
    blockers: [message],
    details: {
      error: message,
    },
  };
}

function firstBlockerStage(
  steps: LateStageClosureSmokeReport["steps"]
): string | null {
  for (const stage of [
    "analysis_artifacts",
    "write_package",
    "paperguru",
    "final_scorecard",
  ] as const) {
    if (steps[stage].status !== "pass") {
      return stage;
    }
  }
  return null;
}

function overallStatus(
  steps: LateStageClosureSmokeReport["steps"]
): LateStageClosureSmokeStepStatus {
  if (Object.values(steps).some((step) => step.status === "failed")) {
    return "failed";
  }
  if (Object.values(steps).some((step) => step.status === "blocked")) {
    return "blocked";
  }
  return "pass";
}

export async function materializeLateStageClosureSmoke(params: {
  projectRoot: string;
  agentId?: string | null;
  now?: string | null;
}): Promise<MaterializeLateStageClosureSmokeResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const now = params.now ?? new Date().toISOString();
  const initialControl = await reconcileWorkflowControl({
    projectRoot,
    now,
  });

  const analysisArtifacts = await capture(
    materializeAnalysisArtifactsImpl({
      projectRoot,
      trigger: "late_stage_closure_smoke",
      agentId: params.agentId,
    })
  );
  const analysisCompletion = await capture(
    resolveWorkflowStageCompletion({
      projectRoot,
      stage: "analysis",
    })
  );
  const analysisStep: LateStageClosureSmokeStep = !analysisArtifacts.ok
    ? failedStep(analysisArtifacts.error)
    : analysisArtifacts.value.materialized
      ? {
          status: "pass",
          blocking_reason: null,
          blockers: [],
          details: {
            materializer: analysisArtifacts.value,
            completion: analysisCompletion.ok
              ? {
                  completion_status: analysisCompletion.value.completionStatus,
                  blocking_reason: analysisCompletion.value.blockingReason ?? null,
                  missing_signals: analysisCompletion.value.missingSignals ?? [],
                }
              : { error: errorMessage(analysisCompletion.error) },
          },
        }
      : !analysisCompletion.ok
        ? failedStep(analysisCompletion.error)
        : completionStep({
            completion: analysisCompletion.value,
            details: {
              materializer: analysisArtifacts.value,
            },
          });

  const writePackage = await capture(
    assembleWritePackage({
      projectRoot,
      mode: "deterministic",
      trigger: "late_stage_closure_smoke",
      agentId: params.agentId,
    })
  );
  const writePackageStep: LateStageClosureSmokeStep =
    !writePackage.ok
      ? failedStep(writePackage.error)
      : (() => {
          const blockers = uniqueStrings([
            ...writePackage.value.validationErrors,
            ...writePackage.value.blockingInputs,
            asString(writePackage.value.state.pendingReason) ?? "",
          ]);
          const ready =
            writePackage.value.state.status === "ready" &&
            writePackage.value.validationErrors.length === 0 &&
            writePackage.value.blockingInputs.length === 0;
          return {
            status: ready ? "pass" : "blocked",
            blocking_reason: ready ? null : blockers[0] ?? "write_package_blocked",
            blockers,
            details: {
              state_status: writePackage.value.state.status,
              assembly_status: writePackage.value.state.assemblyStatus,
              derived_artifacts: writePackage.value.derivedArtifacts,
              package_manifest_path: writePackage.value.packageManifestResolvedPath,
              assembly_report_path: writePackage.value.assemblyReportResolvedPath,
              section_assembly_queue_path:
                writePackage.value.sectionAssemblyQueueResolvedPath,
            },
          };
        })();

  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? initialControl.manifest;
  const paperGuruGate = await capture(
    evaluatePaperGuruGate({
      projectRoot,
      manifest,
    })
  );
  const paperGuruStep: LateStageClosureSmokeStep =
    !paperGuruGate.ok
      ? failedStep(paperGuruGate.error)
      : {
          status:
            paperGuruGate.value.status === "ready" ||
            paperGuruGate.value.status === "optional"
              ? "pass"
              : "blocked",
          blocking_reason:
            paperGuruGate.value.status === "blocked"
              ? paperGuruGate.value.missingSignals[0] ?? "paperguru_gate_blocked"
              : null,
          blockers: paperGuruGate.value.missingSignals,
          details: {
            gate_status: paperGuruGate.value.status,
            paper_guru_state: paperGuruGate.value.paperGuruState,
          },
        };

  const finalScorecard = await capture(
    materializeWorkflowFinalScorecard({
      projectRoot,
      now,
    })
  );
  const finalScorecardStep: LateStageClosureSmokeStep =
    !finalScorecard.ok
      ? failedStep(finalScorecard.error)
      : {
          status: finalScorecard.value.status === "pass" ? "pass" : "blocked",
          blocking_reason:
            finalScorecard.value.status === "pass"
              ? null
              : finalScorecard.value.scorecard.blockers[0] ??
                "final_scorecard_blocked",
          blockers: finalScorecard.value.scorecard.blockers,
          details: {
            scorecard_status: finalScorecard.value.status,
            scorecard_path: finalScorecard.value.scorecardPath,
            canonical: finalScorecard.value.scorecard.canonical,
          },
        };
  const finalControl = await reconcileWorkflowControl({
    projectRoot,
    now,
  });
  const steps = {
    analysis_artifacts: analysisStep,
    write_package: writePackageStep,
    paperguru: paperGuruStep,
    final_scorecard: finalScorecardStep,
  };
  const status = overallStatus(steps);
  const blockerStage = firstBlockerStage(steps);
  const blockers = uniqueStrings(
    Object.entries(steps).flatMap(([stage, step]) =>
      step.blockers.map((blocker) => `${stage}:${blocker}`)
    )
  );
  const latestManifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? finalControl.manifest;
  const smokePath = path.join(projectRoot, LATE_STAGE_SMOKE_RELATIVE_PATH);
  const report: LateStageClosureSmokeReport = {
    schema_version: "late-stage-closure-smoke-v1",
    generated_at: now,
    status,
    first_blocker_stage: blockerStage,
    project_id: asString(latestManifest.project_id ?? latestManifest.projectId),
    authority: {
      canonical_completion_source: "PROJECT_MANIFEST.json.workflow_control",
      smoke_is_completion_authority: false,
      smoke_purpose: "derived_diagnostic",
    },
    canonical_before: summarizeWorkflowControl(initialControl.contract),
    canonical_after: summarizeWorkflowControl(finalControl.contract),
    steps,
    blockers,
    artifact_paths: {
      smoke_path: LATE_STAGE_SMOKE_RELATIVE_PATH,
      final_scorecard_path:
        finalScorecard.ok ? finalScorecard.value.scorecardPath : null,
    },
  };
  await writeJsonAtomicEnsured(smokePath, report);
  return {
    materialized: true,
    status,
    firstBlockerStage: blockerStage,
    smokePath,
    report,
  };
}
