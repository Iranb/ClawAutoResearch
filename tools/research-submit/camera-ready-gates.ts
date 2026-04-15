import {
  normalizeCameraReadyEvidenceState,
  serializeCameraReadyEvidenceState,
} from "../research-contracts/evidence-contracts.ts";
import {
  nowIso,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io.ts";
import { materializeFigureTableRegistry } from "../research-authoring/figure-table-registry.ts";
import { materializeManuscriptLintReport } from "../research-authoring/manuscript-lint.ts";

export async function materializeCameraReadyAudit(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeCameraReadyEvidenceState(manifest.camera_ready_evidence);
  const patch = params.patch ?? {};
  const registry = await materializeFigureTableRegistry({ projectRoot: params.projectRoot });
  const lint = await materializeManuscriptLintReport({ projectRoot: params.projectRoot });
  const figuresStatus =
    registry.unresolvedFigurePlaceholders === 0 && registry.figures.every((entry) => entry.captionPresent)
      ? "ready"
      : "needs_revision";
  const tablesStatus =
    registry.unresolvedTablePlaceholders === 0 && registry.tables.every((entry) => entry.captionPresent)
      ? "ready"
      : "needs_revision";
  const captionsStatus =
    [...registry.figures, ...registry.tables].every((entry) => entry.captionPresent)
      ? "ready"
      : "needs_revision";
  const defaultAuditPath = current.auditPath ?? "submit/FINAL_CONSISTENCY_AUDIT.md";
  const auditPath =
    (typeof patch.audit_path === "string" && patch.audit_path) ||
    (typeof patch.auditPath === "string" && patch.auditPath) ||
    defaultAuditPath;
  const defaultPackagePath =
    current.packagePath ?? "academic_writer/CAMERA_READY_EVIDENCE.json";
  const packagePath =
    (typeof patch.package_path === "string" && patch.package_path) ||
    (typeof patch.packagePath === "string" && patch.packagePath) ||
    defaultPackagePath;
  await writeProjectJson(params.projectRoot, packagePath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    figuresStatus,
    tablesStatus,
    captionsStatus,
    lintStatus: lint.status,
    figureRegistryPath: registry.figureRegistryPath,
    tableRegistryPath: registry.tableRegistryPath,
  });
  const next = normalizeCameraReadyEvidenceState({
    ...serializeCameraReadyEvidenceState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      (lint.status === "clean" && figuresStatus === "ready" && tablesStatus === "ready" ? "ready" : "partial"),
    package_path: packagePath,
    audit_path: auditPath,
    figures_status:
      (typeof patch.figures_status === "string" && patch.figures_status) ||
      (typeof patch.figuresStatus === "string" && patch.figuresStatus) ||
      figuresStatus,
    tables_status:
      (typeof patch.tables_status === "string" && patch.tables_status) ||
      (typeof patch.tablesStatus === "string" && patch.tablesStatus) ||
      tablesStatus,
    captions_status:
      (typeof patch.captions_status === "string" && patch.captions_status) ||
      (typeof patch.captionsStatus === "string" && patch.captionsStatus) ||
      captionsStatus,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (lint.status === "clean" && figuresStatus === "ready" && tablesStatus === "ready"
        ? null
        : "Camera-ready package still contains lint issues or unresolved figure/table placeholders."),
    last_materialized_at: nowIso(),
  });
  manifest.camera_ready_evidence = serializeCameraReadyEvidenceState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
