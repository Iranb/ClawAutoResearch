import * as path from "node:path";
import type { ManifestLike, StageSignalsContext } from "./types";

function normalizeReviewVerdict(value: unknown): "pass" | "revise" | "block" | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "pass" || raw === "revise") {
    return raw;
  }
  if (raw === "block" || raw === "blocked") {
    return "block";
  }
  return null;
}

function isReviewCompleted(status: unknown, verdict: unknown): boolean {
  const normalizedStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (normalizedStatus === "ready" || normalizedStatus === "skipped") {
    return true;
  }
  return normalizeReviewVerdict(verdict) !== null;
}

export interface ExecutionStageDeps {
  isNonEmptyDirectory: (targetPath: string) => Promise<boolean>;
  pathExists: (targetPath: string) => Promise<boolean>;
  manifestFieldExists: (manifest: ManifestLike | null, pathSpec: string[]) => boolean;
  getExperimentLedgerPath: (projectRoot: string) => string;
  loadExperimentSearchState: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<any>;
  loadExperimentReviewState: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<any>;
  isExperimentSearchReadyForAnalysis: (state: any) => boolean;
  hasActiveExperimentRuns: (ledger: Record<string, unknown> | null) => boolean;
  normalizeAutonomousExecutionState: (value: unknown) => {
    experimentLaunchMode: "manual" | "reviewed_auto";
    requireAnalyzerReview: boolean;
    requireCrossReview: boolean;
  };
  normalizeBenchmarkProtocolState: (value: unknown) => any;
  normalizeStatisticalEvidenceState: (value: unknown) => any;
  normalizeAblationEvidenceState: (value: unknown) => any;
  normalizeOpportunityScorecardState: (value: unknown) => any;
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
  normalizeWritingContractState: (value: unknown) => any;
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
  DEFAULT_FIGURE_REVIEW_PATH: string;
  DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH: string;
}

export async function collectExperimentStageMissingSignals(
  ctx: StageSignalsContext,
  deps: ExecutionStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const experimentSearch = await deps.loadExperimentSearchState({
    projectRoot: ctx.projectRoot,
    manifest: ctx.manifest,
  });
  const autonomousExecution = deps.normalizeAutonomousExecutionState(
    ctx.manifest?.autonomous_execution
  );
  const experimentReview = await deps.loadExperimentReviewState({
    projectRoot: ctx.projectRoot,
    manifest: ctx.manifest,
  });
  const reviewedAutoPrelaunch =
    autonomousExecution.experimentLaunchMode === "reviewed_auto" &&
    !deps.hasActiveExperimentRuns(ctx.experimentLedger) &&
    !deps.isExperimentSearchReadyForAnalysis(experimentSearch);
  if (reviewedAutoPrelaunch) {
    if (experimentReview.status === "missing") {
      missing.push("PROJECT_MANIFEST.json.experiment_review_state.status must not be missing in reviewed_auto mode");
    }
    const requiredArtifacts = [
      experimentReview.packetPath,
      experimentReview.plannerPlanPath,
      experimentReview.launchDecisionPath,
    ].filter((entry) => typeof entry === "string" && entry.trim().length > 0);
    for (const artifactPath of requiredArtifacts) {
      const resolved = deps.resolveProjectArtifactPath(ctx.projectRoot, artifactPath);
      if (!resolved || !(await deps.pathExists(resolved))) {
        missing.push(`{PROJ}/${artifactPath}`);
      }
    }
    if (!isReviewCompleted(experimentReview.plannerStatus, null)) {
      missing.push("PROJECT_MANIFEST.json.experiment_review_state.planner_status = ready");
    }
    if (
      autonomousExecution.requireAnalyzerReview &&
      !isReviewCompleted(
        experimentReview.analyzerStatus,
        experimentReview.analyzerVerdict
      )
    ) {
      missing.push("PROJECT_MANIFEST.json.experiment_review_state.analyzer_status = ready");
    }
    if (
      autonomousExecution.requireCrossReview &&
      !isReviewCompleted(
        experimentReview.crossReviewerStatus,
        experimentReview.crossReviewerVerdict
      )
    ) {
      missing.push(
        "PROJECT_MANIFEST.json.experiment_review_state.cross_reviewer_status = ready"
      );
    }
    if (experimentReview.blockerCount > 0) {
      missing.push(
        `Experiment review blockers remain before launch: ${(experimentReview.blockers ?? []).join("; ")}`
      );
    }
    if (!experimentReview.launchApproved) {
      missing.push(
        "PROJECT_MANIFEST.json.experiment_review_state.launch_approved = true or set autonomous_execution.experiment_launch_mode = manual"
      );
    }
    return missing;
  }
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
  if (!deps.isExperimentSearchReadyForAnalysis(experimentSearch)) {
    missing.push(
      `PROJECT_MANIFEST.json.experiment_search must be ready_for_analysis with multi_seed + plot pack complete before ANALYZE (current: status=${experimentSearch.status}, multi_seed=${experimentSearch.multiSeedStatus}, plot_pack=${experimentSearch.plotPackStatus})`
    );
  }

  const opportunityScorecard = deps.normalizeOpportunityScorecardState(
    ctx.manifest?.opportunity_scorecard
  );
  if (
    opportunityScorecard.verdict === "worth_top_tier_bet" &&
    deps.isExperimentSearchReadyForAnalysis(experimentSearch) &&
    !deps.hasActiveExperimentRuns(ctx.experimentLedger)
  ) {
    const benchmarkProtocol = deps.normalizeBenchmarkProtocolState(
      ctx.manifest?.benchmark_protocol
    );
    const statisticalEvidence = deps.normalizeStatisticalEvidenceState(
      ctx.manifest?.statistical_evidence
    );
    const ablationEvidence = deps.normalizeAblationEvidenceState(
      ctx.manifest?.ablation_evidence
    );

    if (benchmarkProtocol.status === "missing") {
      missing.push(
        "PROJECT_MANIFEST.json.benchmark_protocol.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (benchmarkProtocol.locked !== true) {
      missing.push(
        "PROJECT_MANIFEST.json.benchmark_protocol.locked = true before top-tier ANALYZE handoff"
      );
    }
    if (benchmarkProtocol.driftStatus === "fail") {
      missing.push(
        "PROJECT_MANIFEST.json.benchmark_protocol.drift_status must not be fail before top-tier ANALYZE handoff"
      );
    }
    if (statisticalEvidence.status === "missing") {
      missing.push(
        "PROJECT_MANIFEST.json.statistical_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (!statisticalEvidence.claimStrengthStatus) {
      missing.push(
        "PROJECT_MANIFEST.json.statistical_evidence.claim_strength_status must be set before top-tier ANALYZE handoff"
      );
    }
    if (ablationEvidence.status === "missing") {
      missing.push(
        "PROJECT_MANIFEST.json.ablation_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (!ablationEvidence.sufficiencyStatus) {
      missing.push(
        "PROJECT_MANIFEST.json.ablation_evidence.sufficiency_status must be set before top-tier ANALYZE handoff"
      );
    }
  }
  return missing;
}

export async function collectAnalyzeStageMissingSignals(
  ctx: StageSignalsContext,
  deps: ExecutionStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const writingContract = deps.normalizeWritingContractState(
    ctx.manifest?.writing_contract
  );
  const proofAppendixRequired = writingContract.proofAppendixRequired === true;
  for (const file of [
    "NARRATIVE_REPORT.md",
    "CLAIM_EVIDENCE_MATRIX.md",
    "TRACK_VERDICTS.md",
    "UNSUPPORTED_CLAIMS.md",
    "QUALITY_AUDIT.md",
  ]) {
    if (!(await deps.pathExists(path.join(ctx.projectRoot, "analyzer", file)))) {
      missing.push(`{PROJ}/analyzer/${file}`);
    }
  }
  if (proofAppendixRequired) {
    for (const file of ["THEORY_SUPPORT_NOTE.md", "THEORY_STATE.json"]) {
      if (!(await deps.pathExists(path.join(ctx.projectRoot, "analyzer", file)))) {
        missing.push(`{PROJ}/analyzer/${file}`);
      }
    }
    if (
      !(await deps.isNonEmptyDirectory(path.join(ctx.projectRoot, "analyzer", "proof-packets")))
    ) {
      missing.push("{PROJ}/analyzer/proof-packets/");
    }
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
