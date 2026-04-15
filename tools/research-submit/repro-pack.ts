import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  normalizeReproducibilityPackState,
  serializeReproducibilityPackState,
} from "../research-contracts/evidence-contracts";
import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
  writeProjectText,
} from "../research-contracts/core/project-io";

export async function materializeReproPack(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeReproducibilityPackState(manifest.reproducibility_pack);
  const patch = params.patch ?? {};
  const ledger = await readProjectJson<Record<string, unknown>>(
    params.projectRoot,
    "researcher/EXPERIMENT_LEDGER.json"
  );
  const gitRevision = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: params.projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  })();
  const defaultBundlePath = current.bundlePath ?? "submit/REPRO_PACK.json";
  const bundlePath =
    (typeof patch.bundle_path === "string" && patch.bundle_path) ||
    (typeof patch.bundlePath === "string" && patch.bundlePath) ||
    defaultBundlePath;
  const hardwarePath = "submit/HARDWARE_AND_RUNTIME.md";
  const payload = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    gitRevision,
    nodeVersion: process.version,
    platform: process.platform,
    release: os.release(),
    cpuCount: os.cpus().length,
    projectId: manifest.project_id ?? null,
    ledgerSummary: ledger?.summary ?? null,
  };
  await writeProjectJson(params.projectRoot, bundlePath, payload);
  await writeProjectText(
    params.projectRoot,
    hardwarePath,
    `# Hardware And Runtime\n\n- git_revision: ${gitRevision ?? "unknown"}\n- node: ${process.version}\n- platform: ${process.platform}\n- release: ${os.release()}\n- cpus: ${os.cpus().length}\n`
  );
  const next = normalizeReproducibilityPackState({
    ...serializeReproducibilityPackState(current),
    schema_version: 2,
    status: (typeof patch.status === "string" && patch.status) || (ledger ? "ready" : "missing"),
    bundle_path: bundlePath,
    environment_capture_status:
      (typeof patch.environment_capture_status === "string" && patch.environment_capture_status) ||
      (typeof patch.environmentCaptureStatus === "string" && patch.environmentCaptureStatus) ||
      (gitRevision ? "ready" : "partial"),
    regenerate_tables_status:
      (typeof patch.regenerate_tables_status === "string" && patch.regenerate_tables_status) ||
      (typeof patch.regenerateTablesStatus === "string" && patch.regenerateTablesStatus) ||
      ((Array.isArray((ledger?.experiments as unknown[]) ?? []) &&
        (ledger?.experiments as unknown[]).length > 0)
        ? "ready"
        : "pending"),
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (ledger ? null : "EXPERIMENT_LEDGER.json is missing."),
    last_materialized_at: nowIso(),
  });
  manifest.reproducibility_pack = serializeReproducibilityPackState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
