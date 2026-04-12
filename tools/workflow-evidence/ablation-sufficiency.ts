import { normalizeAblationEvidenceState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeAblationSufficiency(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeAblationEvidenceState(manifest.ablation_evidence);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    summary_path: patch.summary_path ?? patch.summaryPath ?? current.summaryPath,
    sufficiency_status: patch.sufficiency_status ?? patch.sufficiencyStatus ?? current.sufficiencyStatus,
    publication_critical_count: patch.publication_critical_count ?? patch.publicationCriticalCount ?? current.publicationCriticalCount,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.ablation_evidence = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeAblationEvidenceState(next);
}
