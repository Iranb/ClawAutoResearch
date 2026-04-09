import type { StageReadinessState } from "./stage-readiness.ts";

export type HandoffEligibilityState = StageReadinessState & {
  canHandoff: boolean;
  recommendedAction: "drive_stage" | "repair_artifact" | "background";
};

export function resolveHandoffEligibility(
  readiness: StageReadinessState
): HandoffEligibilityState {
  const canHandoff = readiness.readyForOwnerWork && readiness.blockingSignals.length === 0;
  const recommendedAction = canHandoff
    ? "drive_stage"
    : readiness.repairableSignals.length > 0
      ? "repair_artifact"
      : "background";

  return {
    ...readiness,
    canHandoff,
    recommendedAction,
  };
}
