import { normalizeResearchProgramState } from "../workflow-guard-state/research-program.ts";
import {
  normalizeAblationEvidenceState,
  serializeAblationEvidenceState,
} from "../research-contracts/evidence-contracts.ts";
import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io.ts";

function collectRequiredAblations(manifest: Record<string, unknown>): string[] {
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const fromTracks = researchProgram.tracks.flatMap((track) => track.requiredAblations ?? []);
  return Array.from(new Set(fromTracks.filter(Boolean)));
}

export async function materializeAblationSufficiency(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeAblationEvidenceState(manifest.ablation_evidence);
  const patch = params.patch ?? {};
  const ledger = await readProjectJson<Record<string, unknown>>(
    params.projectRoot,
    "researcher/EXPERIMENT_LEDGER.json"
  );
  const experiments = Array.isArray(ledger?.experiments)
    ? (ledger?.experiments as Record<string, unknown>[])
    : [];
  const completedLabels = experiments
    .filter((exp) => exp.status === "completed")
    .flatMap((exp) => [
      typeof exp.name === "string" ? exp.name.toLowerCase() : null,
      typeof exp.summary === "string" ? exp.summary.toLowerCase() : null,
      typeof exp.hypothesis === "string" ? exp.hypothesis.toLowerCase() : null,
    ])
    .filter((value): value is string => Boolean(value));
  const requiredAblations = collectRequiredAblations(manifest);
  const missing = requiredAblations.filter(
    (ablation) => !completedLabels.some((label) => label.includes(ablation.toLowerCase()))
  );
  const sufficiencyStatus =
    requiredAblations.length === 0
      ? "not_required"
      : missing.length === 0
        ? "sufficient"
        : missing.length < requiredAblations.length
          ? "partial"
          : "insufficient";
  const defaultSummaryPath = current.summaryPath ?? "researcher/ABLATION_EVIDENCE.json";
  const summaryPath =
    (typeof patch.summary_path === "string" && patch.summary_path) ||
    (typeof patch.summaryPath === "string" && patch.summaryPath) ||
    defaultSummaryPath;
  await writeProjectJson(params.projectRoot, summaryPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    requiredAblations,
    missingAblations: missing,
    completedExperimentCount: completedLabels.length,
    sufficiencyStatus,
  });
  const next = normalizeAblationEvidenceState({
    ...serializeAblationEvidenceState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      (requiredAblations.length === 0 ? "ready" : missing.length === 0 ? "ready" : "partial"),
    summary_path: summaryPath,
    sufficiency_status:
      (typeof patch.sufficiency_status === "string" && patch.sufficiency_status) ||
      (typeof patch.sufficiencyStatus === "string" && patch.sufficiencyStatus) ||
      sufficiencyStatus,
    publication_critical_count:
      (typeof patch.publication_critical_count === "number" && patch.publication_critical_count) ||
      (typeof patch.publicationCriticalCount === "number" && patch.publicationCriticalCount) ||
      requiredAblations.length,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (missing.length > 0 ? `Missing required ablations: ${missing.join(", ")}` : null),
    last_materialized_at: nowIso(),
  });
  manifest.ablation_evidence = serializeAblationEvidenceState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
