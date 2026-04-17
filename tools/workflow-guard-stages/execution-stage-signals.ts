import * as path from "node:path";
import type { ManifestLike, StageSignalsContext } from "./types";
import {
  auditExperimentLaunchDecisionObject,
  auditTheoryStateObject,
} from "../workflow-intermediate-artifact-audit";

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
  normalizeMechanismEvidenceState: (value: unknown) => any;
  normalizeVenueCompetitionState: (value: unknown) => any;
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
  normalizeCitationIntegrityState?: (value: unknown) => any;
  normalizeResultsStorylineState: (value: unknown) => any;
  normalizeTitleAbstractIntroWorkbenchState: (value: unknown) => any;
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
    const launchDecisionResolvedPath = experimentReview.launchDecisionPath
      ? deps.resolveProjectArtifactPath(ctx.projectRoot, experimentReview.launchDecisionPath)
      : null;
    if (launchDecisionResolvedPath) {
      const decisionAudit = auditExperimentLaunchDecisionObject(
        await deps.readJsonIfExists(launchDecisionResolvedPath)
      );
      if (!decisionAudit.ok) {
        missing.push(...decisionAudit.issues);
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
  if (
    experimentSearch.status !== "ready_for_analysis" &&
    deps.normalizeStage(experimentSearch.baselineFairnessStatus) !== "ready"
  ) {
    missing.push(
      `PROJECT_MANIFEST.json.experiment_search.baseline_fairness_status must be ready before analysis (current: ${experimentSearch.baselineFairnessStatus})`
    );
  }
  if (
    experimentSearch.status !== "ready_for_analysis" &&
    !["ready", "trusted"].includes(
      deps.normalizeStage(experimentSearch.implementationConfidence) ?? ""
    )
  ) {
    missing.push(
      `PROJECT_MANIFEST.json.experiment_search.implementation_confidence must be trusted/ready before analysis (current: ${experimentSearch.implementationConfidence})`
    );
  }
  if (
    experimentSearch.status !== "ready_for_analysis" &&
    deps.normalizeStage(experimentSearch.ablationStatus) === "pending"
  ) {
    missing.push(
      `PROJECT_MANIFEST.json.experiment_search.ablation_status must be ready before analysis (current: ${experimentSearch.ablationStatus})`
    );
  }
  if (
    experimentSearch.status !== "ready_for_analysis" &&
    ["innovation_invalidated", "rollback_to_plan", "rollback_to_idea"].includes(
      deps.normalizeStage(experimentSearch.lastDecision) ?? ""
    )
  ) {
    missing.push(
      "Current experiment envelope has been invalidated; rollback to PLAN/IDEA instead of advancing toward ANALYZE."
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
    const theoryStatePath = path.join(ctx.projectRoot, "analyzer", "THEORY_STATE.json");
    const theoryAudit = auditTheoryStateObject(
      await deps.readJsonIfExists(theoryStatePath)
    );
    if (!theoryAudit.ok) {
      missing.push(...theoryAudit.issues);
    }
    if (
      !(await deps.isNonEmptyDirectory(path.join(ctx.projectRoot, "analyzer", "proof-packets")))
    ) {
      missing.push("{PROJ}/analyzer/proof-packets/");
    }
  }

  const opportunityScorecard = deps.normalizeOpportunityScorecardState(
    ctx.manifest?.opportunity_scorecard
  );
  if (opportunityScorecard.verdict === "worth_top_tier_bet") {
    const mechanismEvidence = deps.normalizeMechanismEvidenceState(
      ctx.manifest?.mechanism_evidence
    );
    const venueCompetition = deps.normalizeVenueCompetitionState(
      ctx.manifest?.venue_competition
    );

    if (mechanismEvidence.status === "missing") {
      missing.push(
        "PROJECT_MANIFEST.json.mechanism_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (
      mechanismEvidence.graphContextStatus === "unverified_graph_context" ||
      mechanismEvidence.graphContextStatus === "graph_unavailable"
    ) {
      missing.push(
        `PROJECT_MANIFEST.json.mechanism_evidence.graph_context_status must be graph-grounded before top-tier REVIEW handoff (current: ${mechanismEvidence.graphContextStatus})`
      );
    }
    if (venueCompetition.status === "missing") {
      missing.push(
        "PROJECT_MANIFEST.json.venue_competition.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (
      venueCompetition.graphContextStatus === "unverified_graph_context" ||
      venueCompetition.graphContextStatus === "graph_unavailable"
    ) {
      missing.push(
        `PROJECT_MANIFEST.json.venue_competition.graph_context_status must be graph-grounded before top-tier REVIEW handoff (current: ${venueCompetition.graphContextStatus})`
      );
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
  const resultsStoryline = deps.normalizeResultsStorylineState(
    ctx.manifest?.results_storyline
  );
  const titleAbstractIntroWorkbench = deps.normalizeTitleAbstractIntroWorkbenchState(
    ctx.manifest?.title_abstract_intro_workbench
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
  if (deps.normalizeStage(resultsStoryline.status) !== "ready") {
    missing.push(
      `PROJECT_MANIFEST.json.results_storyline.status must be ready before REVIEW closeout (current: ${resultsStoryline.status})`
    );
  }
  if (deps.normalizeStage(titleAbstractIntroWorkbench.status) !== "ready") {
    missing.push(
      `PROJECT_MANIFEST.json.title_abstract_intro_workbench.status must be ready before REVIEW closeout (current: ${titleAbstractIntroWorkbench.status})`
    );
  }
  const citationIntegrity = deps.normalizeCitationIntegrityState
    ? deps.normalizeCitationIntegrityState(ctx.manifest?.citation_integrity)
    : {
        enabled: false,
        verificationRequired: false,
        verificationStatus: "missing",
        bibliographyEntryCount: 0,
        minimumCitationCount: 0,
        topicRelevanceStatus: "unknown",
      };
  if (citationIntegrity.enabled && citationIntegrity.verificationRequired) {
    if (citationIntegrity.verificationStatus !== "verified") {
      missing.push(
        `PROJECT_MANIFEST.json.citation_integrity.verification_status must be verified before REVIEW closeout (current: ${citationIntegrity.verificationStatus})`
      );
    }
    if (
      citationIntegrity.minimumCitationCount > 0 &&
      citationIntegrity.bibliographyEntryCount < citationIntegrity.minimumCitationCount
    ) {
      missing.push(
        `citation count must reach ${citationIntegrity.minimumCitationCount} before REVIEW closeout (current: ${citationIntegrity.bibliographyEntryCount})`
      );
    }
    if (
      citationIntegrity.minimumCitationCount > 0 &&
      citationIntegrity.topicRelevanceStatus !== "ready"
    ) {
      missing.push(
        `PROJECT_MANIFEST.json.citation_integrity.topic_relevance_status must be ready before REVIEW closeout (current: ${citationIntegrity.topicRelevanceStatus})`
      );
    }
  }
  return missing;
}
