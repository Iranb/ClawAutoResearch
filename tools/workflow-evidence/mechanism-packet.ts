import { normalizeMechanismEvidenceState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeMechanismPacket(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeMechanismEvidenceState(manifest.mechanism_evidence);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    packet_path: patch.packet_path ?? patch.packetPath ?? current.packetPath,
    evidence_tier: patch.evidence_tier ?? patch.evidenceTier ?? current.evidenceTier,
    graph_context_status: patch.graph_context_status ?? patch.graphContextStatus ?? current.graphContextStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.mechanism_evidence = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeMechanismEvidenceState(next);
}
