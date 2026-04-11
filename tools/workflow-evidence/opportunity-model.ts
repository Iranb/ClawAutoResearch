import { normalizeOpportunityScorecardState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeOpportunityModel(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeOpportunityScorecardState(manifest.opportunity_scorecard);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    verdict: patch.verdict ?? current.verdict,
    scorecard_path: patch.scorecard_path ?? patch.scorecardPath ?? current.scorecardPath,
    graph_context_status: patch.graph_context_status ?? patch.graphContextStatus ?? current.graphContextStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.opportunity_scorecard = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeOpportunityScorecardState(next);
}
