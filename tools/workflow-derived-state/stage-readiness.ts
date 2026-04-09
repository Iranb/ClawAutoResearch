import type { TrackInnovationEvidenceState } from "./track-evidence.ts";

export type StageReadinessSignal = {
  code: string;
  message: string;
  repairable: boolean;
};

export type StageReadinessState = {
  readyForOwnerWork: boolean;
  hardBlock: boolean;
  blockingSignals: StageReadinessSignal[];
  repairableSignals: string[];
  backgroundOpportunities: string[];
  suggestedOwner: "workflow" | "owner" | "story";
  handoffMode: "drive_stage" | "repair_artifact" | "background";
  diagnostics: string[];
};

function buildBlockingSignal(code: string, message: string): StageReadinessSignal {
  return {
    code,
    message,
    repairable: false,
  };
}

export function resolveStageReadiness(params: {
  stage?: string | null;
  trackEvidence: TrackInnovationEvidenceState;
  requiredSignals?: string[];
  backgroundOpportunities?: string[];
}): StageReadinessState {
  const evidence = params.trackEvidence;
  const backgroundOpportunities = [...(params.backgroundOpportunities ?? [])];
  const repairableSignals = [...evidence.repairable.repairableSignals];
  const blockingSignals: StageReadinessSignal[] = [];

  if (!evidence.hasGraphBackedInnovationEvidence) {
    if (evidence.repairable.repairable) {
      if (repairableSignals.length === 0) {
        repairableSignals.push(
          evidence.presence === "invalid"
            ? "graph_evidence.invalid_payload"
            : "graph_evidence.missing_artifact"
        );
      }
    } else {
      blockingSignals.push(
        buildBlockingSignal(
          "graph_evidence.missing",
          "Track graph-backed innovation evidence is not yet available."
        )
      );
      backgroundOpportunities.push("continue background research");
    }
  } else if (evidence.importedFromGraphEvidence || evidence.repairable.repairable) {
    if (repairableSignals.length === 0) {
      repairableSignals.push("graph_evidence.materialization_pending");
    }
  }

  for (const requiredSignal of params.requiredSignals ?? []) {
    if (!requiredSignal.trim()) {
      continue;
    }
    const alreadySatisfied =
      evidence.hasGraphBackedInnovationEvidence &&
      evidence.presence !== "invalid" &&
      !blockingSignals.some((signal) => signal.code === requiredSignal);
    if (!alreadySatisfied) {
      blockingSignals.push(
        buildBlockingSignal(
          requiredSignal,
          "The stage still needs this workflow-facing signal before owner work can proceed."
        )
      );
    }
  }

  const readyForOwnerWork =
    blockingSignals.length === 0 &&
    repairableSignals.length === 0 &&
    evidence.hasGraphBackedInnovationEvidence &&
    evidence.presence === "inline_only";

  const handoffMode: StageReadinessState["handoffMode"] = readyForOwnerWork
    ? "drive_stage"
    : repairableSignals.length > 0
      ? "repair_artifact"
      : "background";

  const suggestedOwner: StageReadinessState["suggestedOwner"] = readyForOwnerWork
    ? "owner"
    : repairableSignals.length > 0
      ? "workflow"
      : "story";

  const diagnostics = [
    readyForOwnerWork
      ? "Stage is ready for owner work."
      : repairableSignals.length > 0
        ? "Stage is waiting on workflow-owned repair or materialization."
        : "Stage is paused for background work.",
    ...blockingSignals.map((signal) => signal.message),
  ];

  return {
    readyForOwnerWork,
    hardBlock: blockingSignals.length > 0,
    blockingSignals,
    repairableSignals,
    backgroundOpportunities,
    suggestedOwner,
    handoffMode,
    diagnostics,
  };
}
