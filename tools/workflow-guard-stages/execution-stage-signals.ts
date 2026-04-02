import * as path from "node:path";
import type { ManifestLike, StageSignalsContext } from "./types";

export interface ExecutionStageDeps {
  isNonEmptyDirectory: (targetPath: string) => Promise<boolean>;
  pathExists: (targetPath: string) => Promise<boolean>;
  manifestFieldExists: (manifest: ManifestLike | null, pathSpec: string[]) => boolean;
  getExperimentLedgerPath: (projectRoot: string) => string;
  loadExperimentSearchState: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<any>;
  isExperimentSearchReadyForAnalysis: (state: any) => boolean;
  readJsonIfExists: (targetPath: string) => Promise<Record<string, unknown> | null>;
  normalizeStage: (value: unknown) => string | null;
  normalizeFigureQcState: (value: unknown) => any;
  resolveProjectArtifactPath: (
    projectRoot: string,
    artifactPath: string | null
  ) => string | null;
  findUnsupportedPrimaryClaimsInSelectedWritingScope: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<{ blocked: boolean; reason: string | null }>;
  normalizeReviewPressurePacketState: (value: unknown) => any;
  getReviewPressurePacketValidationErrors: (state: any) => string[];
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
  DEFAULT_FIGURE_REVIEW_PATH: string;
  DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH: string;
}

export async function collectExperimentStageMissingSignals(
  ctx: StageSignalsContext,
  deps: ExecutionStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  if (
    !(await deps.isNonEmptyDirectory(
      path.join(ctx.projectRoot, "researcher", "artifacts", "results")
    ))
  ) {
    missing.push("{PROJ}/researcher/artifacts/results/");
  }
  if (
    !(await deps.pathExists(path.join(ctx.projectRoot, "researcher", "EXPERIMENT_REGISTRY.md")))
  ) {
    missing.push("{PROJ}/researcher/EXPERIMENT_REGISTRY.md");
  }
  if (!(await deps.pathExists(deps.getExperimentLedgerPath(ctx.projectRoot)))) {
    missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json");
  }
  if (!ctx.experimentLedger || (ctx.experimentLedger.experiments?.length ?? 0) === 0) {
    missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json with recorded experiments");
  }
  if (!deps.manifestFieldExists(ctx.manifest, ["experiment_memory", "last_ledger_update_at"])) {
    missing.push("PROJECT_MANIFEST.json.experiment_memory.last_ledger_update_at");
  }
  const experimentSearch = await deps.loadExperimentSearchState({
    projectRoot: ctx.projectRoot,
    manifest: ctx.manifest,
  });
  if (!deps.isExperimentSearchReadyForAnalysis(experimentSearch)) {
    missing.push(
      `PROJECT_MANIFEST.json.experiment_search must be ready_for_analysis with multi_seed + plot pack complete before ANALYZE (current: status=${experimentSearch.status}, multi_seed=${experimentSearch.multiSeedStatus}, plot_pack=${experimentSearch.plotPackStatus})`
    );
  }
  return missing;
}

export async function collectAnalyzeStageMissingSignals(
  ctx: StageSignalsContext,
  deps: ExecutionStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  for (const file of [
    "NARRATIVE_REPORT.md",
    "CLAIM_EVIDENCE_MATRIX.md",
    "TRACK_VERDICTS.md",
    "UNSUPPORTED_CLAIMS.md",
    "QUALITY_AUDIT.md",
    "THEORY_SUPPORT_NOTE.md",
    "THEORY_STATE.json",
  ]) {
    if (!(await deps.pathExists(path.join(ctx.projectRoot, "analyzer", file)))) {
      missing.push(`{PROJ}/analyzer/${file}`);
    }
  }
  if (!(await deps.isNonEmptyDirectory(path.join(ctx.projectRoot, "analyzer", "proof-packets")))) {
    missing.push("{PROJ}/analyzer/proof-packets/");
  }
  return missing;
}

export async function collectReviewStageMissingSignals(
  ctx: StageSignalsContext,
  deps: ExecutionStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const reviewReport = await deps.pathExists(
    path.join(ctx.projectRoot, "reviewer", "REVIEW_REPORT.md")
  );
  const reviewState = await deps.readJsonIfExists(
    path.join(ctx.projectRoot, "researcher", "REVIEW_STATE.json")
  );
  const reviewCompleted = deps.normalizeStage(reviewState?.status) === "completed";
  if (!reviewReport && !reviewCompleted) {
    missing.push("{PROJ}/reviewer/REVIEW_REPORT.md or completed REVIEW_STATE.json");
  }

  const figureQc = deps.normalizeFigureQcState(ctx.manifest?.figure_qc);
  const surfaceReviewPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    figureQc.figureReviewPath ?? deps.DEFAULT_FIGURE_REVIEW_PATH
  );
  if (!surfaceReviewPath || !(await deps.pathExists(surfaceReviewPath))) {
    missing.push(`{PROJ}/${figureQc.figureReviewPath ?? deps.DEFAULT_FIGURE_REVIEW_PATH}`);
  }

  const submissionSimulationPath = path.join(
    ctx.projectRoot,
    deps.DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH
  );
  if (!(await deps.pathExists(submissionSimulationPath))) {
    missing.push(`{PROJ}/${deps.DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH}`);
  }

  const unsupportedPrimaryClaims =
    await deps.findUnsupportedPrimaryClaimsInSelectedWritingScope({
      projectRoot: ctx.projectRoot,
      manifest: ctx.manifest,
    });
  if (unsupportedPrimaryClaims.blocked && unsupportedPrimaryClaims.reason) {
    missing.push(unsupportedPrimaryClaims.reason);
  }

  const reviewPressurePacket = deps.normalizeReviewPressurePacketState(
    ctx.manifest?.review_pressure_packet
  );
  missing.push(...deps.getReviewPressurePacketValidationErrors(reviewPressurePacket));
  for (const relativePath of [
    reviewPressurePacket.rejectFirstReviewPath,
    reviewPressurePacket.noveltyAttackPath,
    reviewPressurePacket.unsupportedClaimAuditPath,
    reviewPressurePacket.reverseOutlinePath,
    reviewPressurePacket.figureTableQcPath,
    reviewPressurePacket.limitationAuditPath,
  ]) {
    const resolvedPath = deps.resolveProjectArtifactPath(ctx.projectRoot, relativePath);
    if (!(await deps.fileHasNonWhitespaceContent(resolvedPath)) && relativePath) {
      missing.push(`{PROJ}/${relativePath}`);
    }
  }
  return missing;
}
