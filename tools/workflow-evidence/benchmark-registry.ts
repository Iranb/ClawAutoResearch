import { normalizeBenchmarkProtocolState } from "./contracts";
import { nowIso, readProjectManifest, readRecord, writeProjectManifest } from "./materializer-utils";

export async function materializeBenchmarkRegistry(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeBenchmarkProtocolState(manifest.benchmark_protocol);
  const patch = readRecord(params.patch);
  const next = {
    status: patch.status ?? current.status,
    benchmark_family: patch.benchmark_family ?? patch.benchmarkFamily ?? current.benchmarkFamily,
    protocol_lock_path: patch.protocol_lock_path ?? patch.protocolLockPath ?? current.protocolLockPath,
    official_eval_recipe: patch.official_eval_recipe ?? patch.officialEvalRecipe ?? current.officialEvalRecipe,
    locked: patch.locked ?? current.locked,
    drift_status: patch.drift_status ?? patch.driftStatus ?? current.driftStatus,
    pending_reason: patch.pending_reason ?? patch.pendingReason ?? current.pendingReason,
    last_materialized_at: nowIso(),
  };
  manifest.benchmark_protocol = next;
  await writeProjectManifest(params.projectRoot, manifest);
  return normalizeBenchmarkProtocolState(next);
}
