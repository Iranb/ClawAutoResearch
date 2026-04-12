import { normalizeCameraReadyEvidenceState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeCameraReadyPack(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeCameraReadyEvidenceState(manifest.camera_ready_evidence);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    package_path: patch.package_path ?? patch.packagePath ?? current.packagePath,
    figures_status: patch.figures_status ?? patch.figuresStatus ?? current.figuresStatus,
    tables_status: patch.tables_status ?? patch.tablesStatus ?? current.tablesStatus,
    captions_status: patch.captions_status ?? patch.captionsStatus ?? current.captionsStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.camera_ready_evidence = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeCameraReadyEvidenceState(next);
}
