import type { StageReadinessState } from "./stage-readiness.ts";
import type {
  TrackEvidenceDiagnostic,
  TrackInnovationEvidenceState,
} from "./track-evidence.ts";

export type DerivedStateDiagnosticSummary = {
  title: string;
  diagnostics: TrackEvidenceDiagnostic[];
  blockingSignals: string[];
  repairableSignals: string[];
  backgroundOpportunities: string[];
  repairable: boolean;
};

export function buildDerivedStateDiagnostics(
  summary: DerivedStateDiagnosticSummary
): DerivedStateDiagnosticSummary {
  return {
    title: summary.title,
    diagnostics: [...summary.diagnostics],
    blockingSignals: [...summary.blockingSignals],
    repairableSignals: [...summary.repairableSignals],
    backgroundOpportunities: [...summary.backgroundOpportunities],
    repairable:
      summary.repairable ||
      summary.repairableSignals.length > 0 ||
      summary.diagnostics.some((entry) => entry.repairable),
  };
}

export function summarizeTrackEvidenceDiagnostics(
  state: TrackInnovationEvidenceState
): DerivedStateDiagnosticSummary {
  return buildDerivedStateDiagnostics({
    title: "Track evidence",
    diagnostics: state.diagnostics,
    blockingSignals: [],
    repairableSignals: state.repairable.repairableSignals,
    backgroundOpportunities: [],
    repairable: state.repairable.repairable,
  });
}

export function summarizeStageReadinessDiagnostics(
  state: StageReadinessState
): DerivedStateDiagnosticSummary {
  return buildDerivedStateDiagnostics({
    title: "Stage readiness",
    diagnostics: [],
    blockingSignals: state.blockingSignals.map((signal) => signal.code),
    repairableSignals: state.repairableSignals,
    backgroundOpportunities: state.backgroundOpportunities,
    repairable: state.repairableSignals.length > 0,
  });
}
