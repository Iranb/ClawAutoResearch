import * as path from "node:path";
import type { StageSignalsContext } from "./types";

export interface WritingStageDeps {
  resolveProjectArtifactPath: (
    projectRoot: string,
    artifactPath: string | null
  ) => string | null;
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
  pathExists: (targetPath: string) => Promise<boolean>;
  isNonEmptyDirectory: (targetPath: string) => Promise<boolean>;
  normalizePaperStoryState: (value: unknown) => any;
  getPaperStoryStateValidationErrors: (state: any) => string[];
  normalizeReviewPressurePacketState: (value: unknown) => any;
  getReviewPressurePacketValidationErrors: (state: any) => string[];
  normalizeWritingContractState: (value: unknown) => any;
  normalizeWritePackageState: (value: unknown) => any;
  evaluateWritingContractState: (params: {
    projectRoot: string;
    state: any;
  }) => Promise<any>;
  normalizeWritingSessionState: (value: unknown) => any;
  getWritingSectionContractViolations: (params: {
    writingSession: any;
    writingContract: any;
  }) => string[];
  isWritingSessionReadyForSubmit: (state: any) => boolean;
  getWritePackageValidationErrors: (state: any) => string[];
  normalizeGraphGuidedWritingState: (value: unknown) => any;
  isGraphGuidedWritingReadyForSubmit: (state: any) => boolean;
  hydrateReviewIssueTrackerState: (params: {
    projectRoot: string;
    value: unknown;
  }) => Promise<any>;
  hasBlockingReviewIssues: (state: any) => boolean;
  hasUnwaivedMediumOrHigherReviewIssues: (state: any) => boolean;
  normalizePaperQcState: (value: unknown) => any;
  normalizeFigureQcState: (value: unknown) => any;
  normalizeCitationCollectionState: (value: unknown) => any;
  normalizeTheorySupportState: (value: unknown) => any;
  normalizeStage: (value: unknown) => string | null;
  normalizeCitationIntegrityState: (value: unknown) => any;
  normalizeExternalReviewState: (value: unknown) => any;
  isExternalReviewConclusionReady: (state: any) => boolean;
  hasPrefixedFile: (dir: string, prefix: string) => Promise<boolean>;
  DEFAULT_KG_STORYLINE_PACKET_PATH: string;
  DEFAULT_THEORY_APPENDIX_PLAN_PATH: string;
  DEFAULT_THEORY_APPENDIX_SECTION_PATH: string;
  DEFAULT_CITATION_BIB_PATH: string;
  DEFAULT_CITATION_REPORT_PATH: string;
}

async function pushMissingNonEmptyArtifact(
  missing: string[],
  projectRoot: string,
  relativePath: string | null | undefined,
  deps: Pick<WritingStageDeps, "resolveProjectArtifactPath" | "fileHasNonWhitespaceContent">
): Promise<void> {
  if (!relativePath) {
    return;
  }
  const resolvedPath = deps.resolveProjectArtifactPath(projectRoot, relativePath);
  if (!(await deps.fileHasNonWhitespaceContent(resolvedPath))) {
    missing.push(`{PROJ}/${relativePath}`);
  }
}

export async function collectWriteStageMissingSignals(
  ctx: StageSignalsContext,
  deps: WritingStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const paperStoryState = deps.normalizePaperStoryState(ctx.manifest?.paper_story_state);
  missing.push(...deps.getPaperStoryStateValidationErrors(paperStoryState));
  for (const relativePath of [
    paperStoryState.taskSummaryPath,
    paperStoryState.challengeStatementPath,
    paperStoryState.insightSummaryPath,
    paperStoryState.contributionMapPath,
    paperStoryState.advantageMapPath,
    paperStoryState.storySpinePath,
    paperStoryState.pipelineFigureSketchPath,
    paperStoryState.moduleMotivationMapPath,
    paperStoryState.claimToExperimentMapPath,
    paperStoryState.fallbackNarrativePath,
    paperStoryState.rejectionRiskTablePath,
  ]) {
    await pushMissingNonEmptyArtifact(missing, ctx.projectRoot, relativePath, deps);
  }

  const reviewPressurePacket = deps.normalizeReviewPressurePacketState(
    ctx.manifest?.review_pressure_packet
  );
  missing.push(...deps.getReviewPressurePacketValidationErrors(reviewPressurePacket));

  const writingContract = deps.normalizeWritingContractState(ctx.manifest?.writing_contract);
  const writePackage = deps.normalizeWritePackageState(ctx.manifest?.write_package);
  const writingContractEval = await deps.evaluateWritingContractState({
    projectRoot: ctx.projectRoot,
    state: writingContract,
  });
  if (
    writingContract.templateRequired &&
    (!writingContractEval.templateResolvedPath || !writingContractEval.templateExists)
  ) {
    missing.push(
      "PROJECT_MANIFEST.json.writing_contract.template_path with an existing user template before Writer drafts prose"
    );
  }
  if (writingContract.kgStorylineRequired) {
    const kgPacketPath =
      deps.resolveProjectArtifactPath(
        ctx.projectRoot,
        writingContract.kgStorylinePacketPath ?? deps.DEFAULT_KG_STORYLINE_PACKET_PATH
      ) ?? path.join(ctx.projectRoot, deps.DEFAULT_KG_STORYLINE_PACKET_PATH);
    if (!(await deps.pathExists(kgPacketPath))) {
      missing.push(
        "{PROJ}/academic_writer/KG_STORYLINE_PACKET.md (or writing_contract.kg_storyline_packet_path)"
      );
    }
    if (writingContract.kgStorylineStatus !== "ready") {
      missing.push(
        `PROJECT_MANIFEST.json.writing_contract.kg_storyline_status = ready (current: ${writingContract.kgStorylineStatus})`
      );
    }
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "academic_writer", "PAPER_PLAN.md")))) {
    missing.push("{PROJ}/academic_writer/PAPER_PLAN.md");
  }
  if (
    !(await deps.pathExists(path.join(ctx.projectRoot, "academic_writer", "STORYLINE_SKETCH.md")))
  ) {
    missing.push("{PROJ}/academic_writer/STORYLINE_SKETCH.md");
  }

  const writingSession = deps.normalizeWritingSessionState(ctx.manifest?.writing_session);
  missing.push(
    ...deps.getWritingSectionContractViolations({
      writingSession,
      writingContract,
    })
  );
  if (!deps.isWritingSessionReadyForSubmit(writingSession)) {
    missing.push(
      `PROJECT_MANIFEST.json.writing_session must be ready_for_submit with publication-ready section packets and covered graph evidence (current: status=${writingSession.status}, coverage=${writingSession.graphEvidenceCoverageStatus})`
    );
  }

  missing.push(...deps.getWritePackageValidationErrors(writePackage));

  const graphGuidedWriting = deps.normalizeGraphGuidedWritingState(
    ctx.manifest?.graph_guided_writing
  );
  if (!deps.isGraphGuidedWritingReadyForSubmit(graphGuidedWriting)) {
    missing.push(
      `PROJECT_MANIFEST.json.graph_guided_writing must report ready/covered evidence with no missing claims (current: status=${graphGuidedWriting.status}, evidence_coverage=${graphGuidedWriting.evidenceCoverageStatus}, missing_claims=${graphGuidedWriting.missingEvidenceClaims.join(",") || "none"})`
    );
  }

  const reviewIssueTracker = await deps.hydrateReviewIssueTrackerState({
    projectRoot: ctx.projectRoot,
    value: ctx.manifest?.review_issue_tracker,
  });
  if (deps.hasBlockingReviewIssues(reviewIssueTracker)) {
    missing.push(
      `PROJECT_MANIFEST.json.review_issue_tracker must have 0 open critical/high issues before submit handoff (current: critical=${reviewIssueTracker.openCounts.critical}, high=${reviewIssueTracker.openCounts.high}, status=${reviewIssueTracker.status})`
    );
  }
  if (deps.hasUnwaivedMediumOrHigherReviewIssues(reviewIssueTracker)) {
    missing.push(
      "PROJECT_MANIFEST.json.review_issue_tracker must resolve or waive all medium+ issues before submit handoff"
    );
  }

  const paperQc = deps.normalizePaperQcState(ctx.manifest?.paper_qc);
  if (deps.normalizeStage(paperQc.compileStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.paper_qc.compile_status = pass (current: ${paperQc.compileStatus})`
    );
  }
  if (deps.normalizeStage(paperQc.pageBudgetStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.paper_qc.page_budget_status = pass (current: ${paperQc.pageBudgetStatus})`
    );
  }
  if (deps.normalizeStage(paperQc.invalidFigureRefStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.paper_qc.invalid_figure_ref_status = pass (current: ${paperQc.invalidFigureRefStatus})`
    );
  }

  const figureQc = deps.normalizeFigureQcState(ctx.manifest?.figure_qc);
  if (deps.normalizeStage(figureQc.duplicateFigureStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.figure_qc.duplicate_figure_status = pass (current: ${figureQc.duplicateFigureStatus})`
    );
  }
  if (deps.normalizeStage(figureQc.captionAlignmentStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.figure_qc.caption_alignment_status = pass (current: ${figureQc.captionAlignmentStatus})`
    );
  }
  if (deps.normalizeStage(figureQc.textAlignmentStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.figure_qc.text_alignment_status = pass (current: ${figureQc.textAlignmentStatus})`
    );
  }
  if (deps.normalizeStage(figureQc.selectionStatus) === "fail") {
    missing.push(
      `PROJECT_MANIFEST.json.figure_qc.selection_status = pass (current: ${figureQc.selectionStatus})`
    );
  }

  const citationCollection = deps.normalizeCitationCollectionState(
    ctx.manifest?.citation_collection
  );
  if (deps.normalizeStage(citationCollection.status) === "blocked") {
    missing.push(
      `PROJECT_MANIFEST.json.citation_collection.status must not be blocked (current: ${citationCollection.status})`
    );
  }
  if (citationCollection.hallucinatedCount > 0) {
    missing.push(
      `PROJECT_MANIFEST.json.citation_collection.hallucinated_count = 0 (current: ${citationCollection.hallucinatedCount})`
    );
  }

  const theorySupport = deps.normalizeTheorySupportState(ctx.manifest?.theory_state);
  if (writingContract.proofAppendixRequired) {
    const theoryStatePath = deps.resolveProjectArtifactPath(
      ctx.projectRoot,
      theorySupport.theoryStatePath
    );
    if (!theoryStatePath || !(await deps.pathExists(theoryStatePath))) {
      missing.push("{PROJ}/analyzer/THEORY_STATE.json");
    }
    const proofPacketDir = deps.resolveProjectArtifactPath(
      ctx.projectRoot,
      theorySupport.proofPacketDir
    );
    if (!proofPacketDir || !(await deps.isNonEmptyDirectory(proofPacketDir))) {
      missing.push("{PROJ}/analyzer/proof-packets/");
    }
    const appendixPlanPath = deps.resolveProjectArtifactPath(
      ctx.projectRoot,
      theorySupport.appendixPacketPath ?? deps.DEFAULT_THEORY_APPENDIX_PLAN_PATH
    );
    if (!appendixPlanPath || !(await deps.pathExists(appendixPlanPath))) {
      missing.push(
        "{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md (or theory_state.appendix_packet_path)"
      );
    }
    const appendixDraftPath = deps.resolveProjectArtifactPath(
      ctx.projectRoot,
      writingContract.proofAppendixPath ?? deps.DEFAULT_THEORY_APPENDIX_SECTION_PATH
    );
    if (!appendixDraftPath || !(await deps.pathExists(appendixDraftPath))) {
      missing.push(
        "{PROJ}/academic_writer/paper/sections/appendix_theory.tex (or writing_contract.proof_appendix_path)"
      );
    }
  }

  const citationIntegrity = deps.normalizeCitationIntegrityState(
    ctx.manifest?.citation_integrity
  );
  const bibliographyPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    citationIntegrity.bibliographyPath
  );
  if (
    citationIntegrity.enabled &&
    citationIntegrity.verificationRequired &&
    citationIntegrity.verificationStatus !== "verified"
  ) {
    missing.push(
      `PROJECT_MANIFEST.json.citation_integrity.verification_status = verified (current: ${citationIntegrity.verificationStatus})`
    );
  }
  if (
    citationIntegrity.enabled &&
    bibliographyPath &&
    !(await deps.pathExists(bibliographyPath))
  ) {
    missing.push(
      `citation bibliography at ${citationIntegrity.bibliographyPath ?? deps.DEFAULT_CITATION_BIB_PATH}`
    );
  }

  if (!(await deps.pathExists(path.join(ctx.projectRoot, "academic_writer", "paper", "main.pdf")))) {
    missing.push("{PROJ}/academic_writer/paper/main.pdf");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "academic_writer", "WRITING_SIGNALS.md")))) {
    missing.push("{PROJ}/academic_writer/WRITING_SIGNALS.md");
  }
  if (!(await deps.isNonEmptyDirectory(path.join(ctx.projectRoot, "cross-reviewer")))) {
    missing.push("{PROJ}/cross-reviewer/");
  }
  return missing;
}

export async function collectSubmitStageMissingSignals(
  ctx: StageSignalsContext,
  deps: WritingStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const citationIntegrity = deps.normalizeCitationIntegrityState(
    ctx.manifest?.citation_integrity
  );
  const externalReview = deps.normalizeExternalReviewState(
    ctx.manifest?.external_review_state
  );
  const verificationReportPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    citationIntegrity.verificationReportPath
  );
  const bibliographyPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    citationIntegrity.bibliographyPath
  );
  const externalReviewPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    externalReview.externalReviewPath
  );
  const reviewResponsePath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    externalReview.reviewResponsePath
  );

  if (citationIntegrity.enabled && citationIntegrity.verificationRequired) {
    if (citationIntegrity.verificationStatus !== "verified") {
      missing.push(
        `PROJECT_MANIFEST.json.citation_integrity.verification_status = verified (current: ${citationIntegrity.verificationStatus})`
      );
    }
    if (
      citationIntegrity.unresolvedPlaceholderCount >
      citationIntegrity.allowedPlaceholderCount
    ) {
      missing.push(
        `citation placeholders <= ${citationIntegrity.allowedPlaceholderCount} (current: ${citationIntegrity.unresolvedPlaceholderCount})`
      );
    }
    if (citationIntegrity.hallucinatedCitationCount > 0) {
      missing.push(
        `citation hallucinations = 0 (current: ${citationIntegrity.hallucinatedCitationCount})`
      );
    }
    if (!verificationReportPath || !(await deps.pathExists(verificationReportPath))) {
      missing.push(
        `{PROJ}/${citationIntegrity.verificationReportPath ?? deps.DEFAULT_CITATION_REPORT_PATH}`
      );
    }
    if (!bibliographyPath || !(await deps.pathExists(bibliographyPath))) {
      missing.push(
        `{PROJ}/${citationIntegrity.bibliographyPath ?? deps.DEFAULT_CITATION_BIB_PATH}`
      );
    }
  }

  if (!deps.isExternalReviewConclusionReady(externalReview)) {
    missing.push(
      `PROJECT_MANIFEST.json.external_review_state must record a received Stanford review conclusion (current: status=${externalReview.status}, recommendation=${externalReview.overallRecommendation ?? "unset"})`
    );
  }
  if (!externalReviewPath || !(await deps.pathExists(externalReviewPath))) {
    missing.push(
      `{PROJ}/${externalReview.externalReviewPath ?? "reviewer/external_review_{date}.md"}`
    );
  }
  if (!reviewResponsePath || !(await deps.pathExists(reviewResponsePath))) {
    missing.push(
      `{PROJ}/${externalReview.reviewResponsePath ?? "reviewer/rebuttal_{date}.md"}`
    );
  }
  if (!(await deps.hasPrefixedFile(path.join(ctx.projectRoot, "reviewer"), "external_review_"))) {
    missing.push("{PROJ}/reviewer/external_review_{date}.md");
  }
  if (!(await deps.hasPrefixedFile(path.join(ctx.projectRoot, "reviewer"), "rebuttal_"))) {
    missing.push("{PROJ}/reviewer/rebuttal_{date}.md");
  }
  return missing;
}
