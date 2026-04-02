import { normalizePaperIngestionState } from "../workflow-guard-state/paper-ingestion";
import type { PaperIngestionState } from "../workflow-guard";

type PaperIngestionManifestLike = {
  paper_ingestion?: unknown;
};

export async function summarizePaperIngestionState(params: {
  manifest: PaperIngestionManifestLike;
}): Promise<{
  state: PaperIngestionState;
}> {
  return {
    state: normalizePaperIngestionState(params.manifest.paper_ingestion),
  };
}
