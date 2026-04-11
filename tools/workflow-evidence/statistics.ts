import { normalizeStatisticalEvidenceState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeStatisticalEvidence(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeStatisticalEvidenceState(manifest.statistical_evidence);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    aggregate_path: patch.aggregate_path ?? patch.aggregatePath ?? current.aggregatePath,
    claim_strength_status: patch.claim_strength_status ?? patch.claimStrengthStatus ?? current.claimStrengthStatus,
    significant_result_count: patch.significant_result_count ?? patch.significantResultCount ?? current.significantResultCount,
    insufficient_seed_count: patch.insufficient_seed_count ?? patch.insufficientSeedCount ?? current.insufficientSeedCount,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.statistical_evidence = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeStatisticalEvidenceState(next);
}
