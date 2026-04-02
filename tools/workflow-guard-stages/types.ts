export type ManifestLike = Record<string, unknown>;
export type TrackRegistryLike = Record<string, unknown>;
export type ExperimentLedgerLike = Record<string, unknown> & {
  experiments?: unknown[];
};

export interface StageSignalsContext {
  projectRoot: string;
  manifest: ManifestLike | null;
  trackRegistry: TrackRegistryLike | null;
  experimentLedger: ExperimentLedgerLike | null;
}

export type WorkflowTrackLike = Record<string, unknown>;
