import { normalizeVenueCompetitionState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeVenueCompetition(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeVenueCompetitionState(manifest.venue_competition);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    target_venues: patch.target_venues ?? patch.targetVenues ?? current.targetVenues,
    competitor_slate_path: patch.competitor_slate_path ?? patch.competitorSlatePath ?? current.competitorSlatePath,
    acceptance_risk_status: patch.acceptance_risk_status ?? patch.acceptanceRiskStatus ?? current.acceptanceRiskStatus,
    graph_context_status: patch.graph_context_status ?? patch.graphContextStatus ?? current.graphContextStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.venue_competition = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeVenueCompetitionState(next);
}
