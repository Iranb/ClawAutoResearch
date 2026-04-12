import { normalizeReproducibilityPackState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeReproducibilityPack(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeReproducibilityPackState(manifest.reproducibility_pack);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    bundle_path: patch.bundle_path ?? patch.bundlePath ?? current.bundlePath,
    environment_capture_status: patch.environment_capture_status ?? patch.environmentCaptureStatus ?? current.environmentCaptureStatus,
    regenerate_tables_status: patch.regenerate_tables_status ?? patch.regenerateTablesStatus ?? current.regenerateTablesStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.reproducibility_pack = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeReproducibilityPackState(next);
}
