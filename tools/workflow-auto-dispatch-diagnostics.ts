import * as path from "node:path";

import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import {
  normalizeAutoDispatchDiagnosticsState,
  serializeAutoDispatchDiagnosticsState,
  type AutoDispatchDiagnosticsState,
} from "./workflow-guard-state/auto-dispatch-diagnostics";

function nowIso(): string {
  return new Date().toISOString();
}

export async function updateAutoDispatchDiagnostics(params: {
  projectRoot: string;
  patch: Partial<AutoDispatchDiagnosticsState>;
}): Promise<AutoDispatchDiagnosticsState> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeAutoDispatchDiagnosticsState(manifest.auto_dispatch_diagnostics);
  const next = normalizeAutoDispatchDiagnosticsState({
    ...serializeAutoDispatchDiagnosticsState(current),
    ...serializeAutoDispatchDiagnosticsState({
      ...current,
      ...params.patch,
      lastCheckedAt: params.patch.lastCheckedAt ?? nowIso(),
    }),
  });
  manifest.auto_dispatch_diagnostics = serializeAutoDispatchDiagnosticsState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return next;
}
