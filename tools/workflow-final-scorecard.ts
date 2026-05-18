import * as path from "node:path";

import { evaluatePaperGuruGate } from "./autoresearch-loop-state";
import { asString } from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import { reconcileWorkflowControl } from "./workflow-control-reconciler";
import {
  resolveWorkflowStageCompletion,
  type StageCompletion,
} from "./workflow-stage-completion";

export type WorkflowFinalScorecardStatus = "pass" | "blocked";

export type WorkflowFinalScorecardStageEntry = {
  stage: string;
  completion_status: StageCompletion["completionStatus"];
  owner: string | null;
  next_action: string | null;
  blocking_reason: string | null;
  contract_source: string;
  missing_signals: string[];
};

export type WorkflowFinalScorecard = {
  schema_version: "workflow-final-scorecard-v1";
  generated_at: string;
  status: WorkflowFinalScorecardStatus;
  project_id: string | null;
  authority: {
    canonical_completion_source: "PROJECT_MANIFEST.json.workflow_control";
    scorecard_is_completion_authority: false;
    scorecard_purpose: "derived_diagnostic";
  };
  canonical: {
    contract_id: string;
    stage: string | null;
    owner: string | null;
    next_action: string | null;
    status: string;
    blocking_reason: string | null;
    completion_status: string;
    completion_source: string;
    runtime_state: string;
  };
  chain: {
    analysis: WorkflowFinalScorecardStageEntry;
    writing: WorkflowFinalScorecardStageEntry;
    review: WorkflowFinalScorecardStageEntry;
    submit: WorkflowFinalScorecardStageEntry;
    done: WorkflowFinalScorecardStageEntry;
  };
  paperguru: {
    status: string;
    missing_signals: string[];
    state: Record<string, unknown>;
  };
  manifest_projection: {
    current_stage: string | null;
    owner_agent: string | null;
    next_action: string | null;
    blocking_reason: string | null;
  };
  blockers: string[];
  artifact_paths: {
    scorecard_path: string;
  };
};

export type MaterializeWorkflowFinalScorecardResult = {
  materialized: true;
  status: WorkflowFinalScorecardStatus;
  scorecardPath: string;
  scorecard: WorkflowFinalScorecard;
};

const FINAL_SCORECARD_RELATIVE_PATH =
  ".openclaw-research/WORKFLOW_FINAL_SCORECARD.json";

function toStageEntry(completion: StageCompletion): WorkflowFinalScorecardStageEntry {
  return {
    stage: completion.stage,
    completion_status: completion.completionStatus,
    owner: completion.owner ?? null,
    next_action: completion.nextAction ?? null,
    blocking_reason: completion.blockingReason ?? null,
    contract_source: completion.contractSource,
    missing_signals: completion.missingSignals ?? [],
  };
}

function collectBlockers(entries: WorkflowFinalScorecardStageEntry[]): string[] {
  const blockers: string[] = [];
  for (const entry of entries) {
    if (entry.blocking_reason) {
      blockers.push(`${entry.stage}:${entry.blocking_reason}`);
    }
    for (const signal of entry.missing_signals) {
      blockers.push(`${entry.stage}:${signal}`);
    }
  }
  return Array.from(new Set(blockers));
}

export async function materializeWorkflowFinalScorecard(params: {
  projectRoot: string;
  now?: string | null;
}): Promise<MaterializeWorkflowFinalScorecardResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const now = params.now ?? new Date().toISOString();
  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now,
  });
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? reconciled.manifest;
  const [
    analysis,
    writing,
    review,
    submit,
    done,
    paperGuruGate,
  ] = await Promise.all([
    resolveWorkflowStageCompletion({ projectRoot, stage: "analysis" }),
    resolveWorkflowStageCompletion({ projectRoot, stage: "writing" }),
    resolveWorkflowStageCompletion({ projectRoot, stage: "review" }),
    resolveWorkflowStageCompletion({ projectRoot, stage: "submit" }),
    resolveWorkflowStageCompletion({ projectRoot, stage: "done" }),
    evaluatePaperGuruGate({ projectRoot, manifest }),
  ]);
  const chain = {
    analysis: toStageEntry(analysis),
    writing: toStageEntry(writing),
    review: toStageEntry(review),
    submit: toStageEntry(submit),
    done: toStageEntry(done),
  };
  const blockers = collectBlockers(Object.values(chain));
  if (paperGuruGate.status === "blocked") {
    blockers.push(...paperGuruGate.missingSignals.map((signal) => `paperguru:${signal}`));
  }
  const status: WorkflowFinalScorecardStatus =
    reconciled.contract.stage === "done" &&
    reconciled.contract.completion.status === "complete" &&
    done.completionStatus === "complete" &&
    blockers.length === 0
      ? "pass"
      : "blocked";
  const scorecard: WorkflowFinalScorecard = {
    schema_version: "workflow-final-scorecard-v1",
    generated_at: now,
    status,
    project_id: asString(manifest.project_id ?? manifest.projectId),
    authority: {
      canonical_completion_source: "PROJECT_MANIFEST.json.workflow_control",
      scorecard_is_completion_authority: false,
      scorecard_purpose: "derived_diagnostic",
    },
    canonical: {
      contract_id: reconciled.contract.contract_id,
      stage: reconciled.contract.stage,
      owner: reconciled.contract.owner,
      next_action: reconciled.contract.next_action,
      status: reconciled.contract.status,
      blocking_reason: reconciled.contract.blocking_reason,
      completion_status: reconciled.contract.completion.status,
      completion_source: reconciled.contract.completion.source,
      runtime_state: reconciled.contract.runtime_state,
    },
    chain,
    paperguru: {
      status: paperGuruGate.status,
      missing_signals: paperGuruGate.missingSignals,
      state: paperGuruGate.paperGuruState,
    },
    manifest_projection: {
      current_stage: asString(manifest.current_stage ?? manifest.currentStage),
      owner_agent: asString(manifest.owner_agent ?? manifest.ownerAgent),
      next_action: asString(manifest.next_action ?? manifest.nextAction),
      blocking_reason: asString(manifest.blocking_reason ?? manifest.blockingReason),
    },
    blockers: Array.from(new Set(blockers)),
    artifact_paths: {
      scorecard_path: FINAL_SCORECARD_RELATIVE_PATH,
    },
  };
  const scorecardPath = path.join(projectRoot, FINAL_SCORECARD_RELATIVE_PATH);
  await writeJsonAtomicEnsured(scorecardPath, scorecard);
  return {
    materialized: true,
    status,
    scorecardPath,
    scorecard,
  };
}
