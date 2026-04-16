import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { StageSignalsContext } from "./types";
import type { ResultsStorylineState } from "../workflow-guard-state/results-storyline";
import type { TitleAbstractIntroWorkbenchState } from "../workflow-guard-state/title-abstract-intro-workbench";
import {
  evaluateCrossDomainInspirationGate,
  normalizeCrossDomainInspirationState,
} from "../idea-catalyst/cross-domain-contract";

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
  evaluateWritingProcessReadiness: (params: {
    writingSession: any;
    writingContract: any;
  }) => {
    processStatus: string;
    missingSections: string[];
    staleSections: string[];
    nextSuggestedSection: string | null;
    rebuildNeeded: boolean;
    rebuildReason: string | null;
    summary: string;
  };
  getWritingSectionContractViolations: (params: {
    writingSession: any;
    writingContract: any;
  }) => string[];
  isWritingSessionReadyForSubmit: (state: any) => boolean;
  getWritePackageValidationErrors: (state: any) => string[];
  normalizeGraphGuidedWritingState: (value: unknown) => any;
  isGraphGuidedWritingReadyForSubmit: (state: any) => boolean;
  normalizeVenueCompetitionState: (value: unknown) => any;
  normalizeOpportunityScorecardState: (value: unknown) => any;
  normalizeReproducibilityPackState: (value: unknown) => any;
  normalizeCameraReadyEvidenceState: (value: unknown) => any;
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
  normalizeInnovationSynthesisState: (value: unknown) => any;
  normalizeResultsStorylineState: (value: unknown) => ResultsStorylineState;
  normalizeStoryGapSearchRequisitionState: (value: unknown) => any;
  normalizeTitleAbstractIntroWorkbenchState: (
    value: unknown
  ) => TitleAbstractIntroWorkbenchState;
  isExternalReviewConclusionReady: (state: any) => boolean;
  hasPrefixedFile: (dir: string, prefix: string) => Promise<boolean>;
  findAnyPdfInDir: (dir: string) => Promise<string | null>;
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

async function readJsonIfExists<T>(targetPath: string | null): Promise<T | null> {
  if (!targetPath) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readNumberField(record: Record<string, unknown> | null, keys: string[]): number {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return 0;
}

function countRegistryEntries(record: Record<string, unknown> | null): number {
  const entries = record?.entries;
  return Array.isArray(entries) ? entries.length : 0;
}

async function readFigureTableBudget(params: {
  projectRoot: string;
  deps: Pick<WritingStageDeps, "resolveProjectArtifactPath">;
}): Promise<{
  figureCount: number;
  tableCount: number;
  frameworkFigureCount: number;
  experimentTableCount: number;
  unresolvedFigurePlaceholders: number;
  unresolvedTablePlaceholders: number;
}> {
  const figureRegistryPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    "academic_writer/FIGURE_REGISTRY.json"
  );
  const tableRegistryPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    "academic_writer/TABLE_REGISTRY.json"
  );
  const figureRegistry = await readJsonIfExists<Record<string, unknown>>(figureRegistryPath);
  const tableRegistry = await readJsonIfExists<Record<string, unknown>>(tableRegistryPath);
  return {
    figureCount:
      readNumberField(figureRegistry, ["totalFigureCount", "total_figure_count"]) ||
      countRegistryEntries(figureRegistry),
    tableCount:
      readNumberField(tableRegistry, ["totalTableCount", "total_table_count"]) ||
      countRegistryEntries(tableRegistry),
    frameworkFigureCount: readNumberField(figureRegistry, [
      "frameworkFigureCount",
      "framework_figure_count",
    ]),
    experimentTableCount: readNumberField(tableRegistry, [
      "experimentTableCount",
      "experiment_table_count",
    ]),
    unresolvedFigurePlaceholders: readNumberField(figureRegistry, [
      "unresolvedPlaceholderCount",
      "unresolved_placeholder_count",
    ]),
    unresolvedTablePlaceholders: readNumberField(tableRegistry, [
      "unresolvedPlaceholderCount",
      "unresolved_placeholder_count",
    ]),
  };
}

function appendFigureTableBudgetSignals(params: {
  missing: string[];
  budget: {
    figureCount: number;
    tableCount: number;
    frameworkFigureCount: number;
    experimentTableCount: number;
    unresolvedFigurePlaceholders: number;
    unresolvedTablePlaceholders: number;
  };
  phase: "write" | "submit";
}) {
  const writeMinimums = [
    {
      label: "framework figure",
      current: params.budget.frameworkFigureCount,
      required: 1,
      message:
        "academic_writer figure/table contract requires at least 1 framework/pipeline/method figure before WRITE handoff",
    },
    {
      label: "experiment table",
      current: params.budget.experimentTableCount,
      required: 2,
      message:
        "academic_writer figure/table contract requires at least 2 experiment/result tables before WRITE handoff",
    },
  ];
  for (const minimum of writeMinimums) {
    if (minimum.current < minimum.required) {
      params.missing.push(
        `${minimum.message} (current ${minimum.current}/${minimum.required})`
      );
    }
  }
  if (params.phase === "submit") {
    if (params.budget.figureCount < 5) {
      params.missing.push(
        `academic_writer final figure budget requires at least 5 figures before SUBMIT (current ${params.budget.figureCount}/5)`
      );
    }
    if (params.budget.tableCount < 4) {
      params.missing.push(
        `academic_writer final table budget requires at least 4 tables before SUBMIT (current ${params.budget.tableCount}/4)`
      );
    }
  }
  if (params.budget.unresolvedFigurePlaceholders > 0) {
    params.missing.push(
      `academic_writer figure registry has unresolved figure placeholders (current ${params.budget.unresolvedFigurePlaceholders})`
    );
  }
  if (params.budget.unresolvedTablePlaceholders > 0) {
    params.missing.push(
      `academic_writer table registry has unresolved table placeholders (current ${params.budget.unresolvedTablePlaceholders})`
    );
  }
}

function appendTopTierOpportunitySignals(params: {
  missing: string[];
  manifest: Record<string, unknown> | null;
  deps: Pick<
    WritingStageDeps,
    "normalizeVenueCompetitionState" | "normalizeOpportunityScorecardState"
  >;
}) {
  const opportunityScorecard = params.deps.normalizeOpportunityScorecardState(
    params.manifest?.opportunity_scorecard
  );
  if (opportunityScorecard.verdict !== "worth_top_tier_bet") {
    return;
  }

  const venueCompetition = params.deps.normalizeVenueCompetitionState(
    params.manifest?.venue_competition
  );
  if (venueCompetition.status === "missing") {
    params.missing.push(
      "PROJECT_MANIFEST.json.venue_competition.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (
    venueCompetition.graphContextStatus === "unverified_graph_context" ||
    venueCompetition.graphContextStatus === "graph_unavailable"
  ) {
    params.missing.push(
      `PROJECT_MANIFEST.json.venue_competition.graph_context_status must be graph-grounded before top-tier WRITE/SUBMIT handoff (current: ${venueCompetition.graphContextStatus})`
    );
  }
  if (
    opportunityScorecard.graphContextStatus === "unverified_graph_context" ||
    opportunityScorecard.graphContextStatus === "graph_unavailable"
  ) {
    params.missing.push(
      `PROJECT_MANIFEST.json.opportunity_scorecard.graph_context_status must be graph-grounded before top-tier WRITE/SUBMIT handoff (current: ${opportunityScorecard.graphContextStatus})`
    );
  }
}

function appendTopTierDeliverySignals(params: {
  missing: string[];
  manifest: Record<string, unknown> | null;
  phase: "write" | "submit";
  deps: Pick<
    WritingStageDeps,
    "normalizeOpportunityScorecardState" | "normalizeReproducibilityPackState" | "normalizeCameraReadyEvidenceState"
  >;
}) {
  const opportunityScorecard = params.deps.normalizeOpportunityScorecardState(
    params.manifest?.opportunity_scorecard
  );
  if (opportunityScorecard.verdict !== "worth_top_tier_bet") {
    return;
  }

  if (params.phase === "write") {
    const reproducibilityPack = params.deps.normalizeReproducibilityPackState(
      params.manifest?.reproducibility_pack
    );
    if (reproducibilityPack.status === "missing") {
      params.missing.push(
        "PROJECT_MANIFEST.json.reproducibility_pack.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
      );
    }
    if (!reproducibilityPack.environmentCaptureStatus) {
      params.missing.push(
        "PROJECT_MANIFEST.json.reproducibility_pack.environment_capture_status must be set before top-tier WRITE handoff"
      );
    }
    return;
  }

  const cameraReadyEvidence = params.deps.normalizeCameraReadyEvidenceState(
    params.manifest?.camera_ready_evidence
  );
  if (cameraReadyEvidence.status === "missing") {
    params.missing.push(
      "PROJECT_MANIFEST.json.camera_ready_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  for (const [label, value] of [
    ["figures_status", cameraReadyEvidence.figuresStatus],
    ["tables_status", cameraReadyEvidence.tablesStatus],
    ["captions_status", cameraReadyEvidence.captionsStatus],
  ] as const) {
    if (!["ready", "pass", "complete", "completed"].includes(String(value ?? "").trim().toLowerCase())) {
      params.missing.push(
        `PROJECT_MANIFEST.json.camera_ready_evidence.${label} must be ready before top-tier SUBMIT handoff (current: ${value ?? "unset"})`
      );
    }
  }
}

export async function collectWriteStageMissingSignals(
  ctx: StageSignalsContext,
  deps: WritingStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const writingContract = deps.normalizeWritingContractState(ctx.manifest?.writing_contract);
  const surveyWriteMode =
    writingContract.paperMode === "survey" || writingContract.paper_mode === "survey";
  const innovationSynthesis = deps.normalizeInnovationSynthesisState(
    ctx.manifest?.innovation_synthesis_state
  );
  const resultsStoryline = deps.normalizeResultsStorylineState(
    ctx.manifest?.results_storyline
  );
  const storyGapSearch = deps.normalizeStoryGapSearchRequisitionState(
    ctx.manifest?.story_gap_search_requisition
  );
  const titleAbstractIntroWorkbench = deps.normalizeTitleAbstractIntroWorkbenchState(
    ctx.manifest?.title_abstract_intro_workbench
  );
  const paperStoryState = deps.normalizePaperStoryState(ctx.manifest?.paper_story_state);
  if (!surveyWriteMode) {
    missing.push(...deps.getPaperStoryStateValidationErrors(paperStoryState));
  }

  // Phase 3.3 — Idea-to-claim traceability: every claim must be traceable to
  // an idea fragment via IDEA_TO_CLAIM_MAP.json before WRITE proceeds.
  if (!surveyWriteMode && paperStoryState.ideaToClaimMapPath) {
    const ideaToClaimMapResolved = deps.resolveProjectArtifactPath(
      ctx.projectRoot,
      paperStoryState.ideaToClaimMapPath
    );
    if (!(await deps.fileHasNonWhitespaceContent(ideaToClaimMapResolved))) {
      missing.push(
        "WRITE stage requires all claims to be traceable to idea fragments — " +
        `{PROJ}/${paperStoryState.ideaToClaimMapPath} must exist and be non-empty`
      );
    }
  }

  const reviewPressurePacket = deps.normalizeReviewPressurePacketState(
    ctx.manifest?.review_pressure_packet
  );
  if (!surveyWriteMode) {
    missing.push(...deps.getReviewPressurePacketValidationErrors(reviewPressurePacket));
  }

  const writePackage = deps.normalizeWritePackageState(ctx.manifest?.write_package);
  if (!surveyWriteMode) {
    missing.push(...deps.getWritePackageValidationErrors(writePackage));
  }
  if (
    !surveyWriteMode &&
    ctx.manifest?.cross_domain_inspiration &&
    typeof ctx.manifest.cross_domain_inspiration === "object"
  ) {
    const crossDomain = normalizeCrossDomainInspirationState(
      ctx.manifest.cross_domain_inspiration
    );
    const headlineClaim =
      (ctx.manifest.writing_contract as Record<string, unknown> | undefined)
        ?.cross_domain_headline_claim === true;
    const crossDomainGate = evaluateCrossDomainInspirationGate({
      state: crossDomain,
      workflowLine:
        writingContract.paperMode === "survey" || writingContract.paper_mode === "survey"
          ? "survey"
          : "experiment",
      headlineClaim,
    });
    if (!crossDomainGate.ready) {
      missing.push(...crossDomainGate.blockers);
    }
    if (crossDomain.status === "partial") {
      await pushMissingNonEmptyArtifact(
        missing,
        ctx.projectRoot,
        crossDomain.evidenceDebtPath,
        deps
      );
    }
  }
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
  const writingSession = deps.normalizeWritingSessionState(ctx.manifest?.writing_session);
  const writingProcess = deps.evaluateWritingProcessReadiness({
    writingSession,
    writingContract,
  });
  if (writingProcess.rebuildNeeded) {
    missing.push(
      `writing process is not bootstrapped yet: ${writingProcess.rebuildReason ?? writingProcess.summary}`
    );
  } else {
    if (writingProcess.staleSections.length > 0) {
      missing.push(
        `writing process has stale section packets: ${writingProcess.staleSections.join(", ")}`
      );
    }
    if (writingProcess.processStatus !== "ready_for_submit") {
      const fragment = [
        `writing process is ${writingProcess.processStatus}`,
        writingProcess.missingSections.length > 0
          ? `missing sections: ${writingProcess.missingSections.join(", ")}`
          : null,
        writingProcess.nextSuggestedSection
          ? `next suggested section: ${writingProcess.nextSuggestedSection}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      missing.push(fragment);
    }
    if (
      deps.normalizeStage(writingSession.graphEvidenceCoverageStatus) === "missing" ||
      deps.normalizeStage(writingSession.headlineClaimEvidenceStatus) === "unsupported"
    ) {
      missing.push(
        `writing claim/evidence coverage is not ready yet (headline=${writingSession.headlineClaimEvidenceStatus}, graph=${writingSession.graphEvidenceCoverageStatus})`
      );
    }
  }

  const graphGuidedWriting = deps.normalizeGraphGuidedWritingState(
    ctx.manifest?.graph_guided_writing
  );
  if (
    graphGuidedWriting.enabled &&
    deps.normalizeStage(graphGuidedWriting.status) === "missing"
  ) {
    missing.push(
      `graph_guided_writing has not been initialized yet (current: status=${graphGuidedWriting.status})`
    );
  }
  const reviewIssueTracker = await deps.hydrateReviewIssueTrackerState({
    projectRoot: ctx.projectRoot,
    value: ctx.manifest?.review_issue_tracker,
  });
  if (deps.hasBlockingReviewIssues(reviewIssueTracker)) {
    missing.push(
      `PROJECT_MANIFEST.json.review_issue_tracker must have 0 open critical/high issues before write handoff (current: critical=${reviewIssueTracker.openCounts.critical}, high=${reviewIssueTracker.openCounts.high}, status=${reviewIssueTracker.status})`
    );
  }
  if (!surveyWriteMode && deps.hasUnwaivedMediumOrHigherReviewIssues(reviewIssueTracker)) {
    missing.push(
      "PROJECT_MANIFEST.json.review_issue_tracker must resolve or waive all medium+ issues before write handoff"
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
  appendFigureTableBudgetSignals({
    missing,
    budget: await readFigureTableBudget({
      projectRoot: ctx.projectRoot,
      deps,
    }),
    phase: "write",
  });
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
  if (citationIntegrity.enabled && citationIntegrity.verificationRequired) {
    if (citationIntegrity.verificationStatus !== "verified") {
      missing.push(
        `PROJECT_MANIFEST.json.citation_integrity.verification_status = verified (current: ${citationIntegrity.verificationStatus})`
      );
    }
    if (!citationIntegrity.allCitationsReal) {
      missing.push(
        "PROJECT_MANIFEST.json.citation_integrity.all_citations_real = true before WRITE handoff"
      );
    }
  }
  appendTopTierOpportunitySignals({
    missing,
    manifest: ctx.manifest,
    deps,
  });
  appendTopTierDeliverySignals({
    missing,
    manifest: ctx.manifest,
    phase: "write",
    deps,
  });
  if (deps.normalizeStage(innovationSynthesis.status) === "needs_search") {
    missing.push(
      `innovation_synthesis requires supplemental search before WRITE handoff (search_gap_count=${innovationSynthesis.searchGapCount ?? 0}, search_status=${storyGapSearch.status ?? "missing"})`
    );
  }
  if (deps.normalizeStage(resultsStoryline.status) === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.results_storyline.status must not be missing during WRITE; materialize RESULTS_QUESTION_ORDER.md before handoff."
    );
  }
  if (deps.normalizeStage(titleAbstractIntroWorkbench.status) === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.title_abstract_intro_workbench.status must not be missing during WRITE; materialize title / abstract / intro workbench artifacts before handoff."
    );
  }
  return missing;
}

export async function collectSubmitStageMissingSignals(
  ctx: StageSignalsContext,
  deps: WritingStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const writingContract = deps.normalizeWritingContractState(ctx.manifest?.writing_contract);
  const innovationSynthesis = deps.normalizeInnovationSynthesisState(
    ctx.manifest?.innovation_synthesis_state
  );
  const resultsStoryline = deps.normalizeResultsStorylineState(
    ctx.manifest?.results_storyline
  );
  const titleAbstractIntroWorkbench = deps.normalizeTitleAbstractIntroWorkbenchState(
    ctx.manifest?.title_abstract_intro_workbench
  );
  const writingSession = deps.normalizeWritingSessionState(ctx.manifest?.writing_session);
  const writingProcess = deps.evaluateWritingProcessReadiness({
    writingSession,
    writingContract,
  });
  if (!deps.isWritingSessionReadyForSubmit(writingSession)) {
    missing.push(
      `PROJECT_MANIFEST.json.writing_session must be ready_for_submit before SUBMIT (current: ${writingProcess.summary})`
    );
  }
  if (deps.normalizeStage(innovationSynthesis.status) !== "ready") {
    missing.push(
      `PROJECT_MANIFEST.json.innovation_synthesis_state.status must be ready before SUBMIT (current: ${innovationSynthesis.status})`
    );
  }
  if (deps.normalizeStage(resultsStoryline.status) !== "ready") {
    missing.push(
      `PROJECT_MANIFEST.json.results_storyline.status must be ready before SUBMIT (current: ${resultsStoryline.status})`
    );
  }
  if (deps.normalizeStage(titleAbstractIntroWorkbench.status) !== "ready") {
    missing.push(
      `PROJECT_MANIFEST.json.title_abstract_intro_workbench.status must be ready before SUBMIT (current: ${titleAbstractIntroWorkbench.status})`
    );
  }
  missing.push(
    ...deps.getWritingSectionContractViolations({
      writingSession,
      writingContract,
    })
  );
  const writePackage = deps.normalizeWritePackageState(ctx.manifest?.write_package);
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
  appendFigureTableBudgetSignals({
    missing,
    budget: await readFigureTableBudget({
      projectRoot: ctx.projectRoot,
      deps,
    }),
    phase: "submit",
  });
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
    if (!citationIntegrity.allCitationsReal) {
      missing.push(
        "PROJECT_MANIFEST.json.citation_integrity.all_citations_real = true — reviewer must confirm that all cited references are real"
      );
    }
    if (citationIntegrity.bibliographyPageCount < 1) {
      missing.push(
        `PROJECT_MANIFEST.json.citation_integrity.bibliography_page_count >= 1 (current: ${citationIntegrity.bibliographyPageCount})`
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

  const availablePdfPath = await deps.findAnyPdfInDir(
    path.join(ctx.projectRoot, "academic_writer", "paper")
  );
  if (!availablePdfPath) {
    missing.push(
      "{PROJ}/academic_writer/paper/*.pdf — reviewer submit work requires at least one compiled PDF; rerun writer compile if none exists"
    );
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "academic_writer", "WRITING_SIGNALS.md")))) {
    missing.push("{PROJ}/academic_writer/WRITING_SIGNALS.md");
  }
  if (!(await deps.isNonEmptyDirectory(path.join(ctx.projectRoot, "cross-reviewer")))) {
    missing.push("{PROJ}/cross-reviewer/");
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

  // Phase 5.4 — External reviewer simulation: require simulated review
  // before SUBMIT to catch issues an area chair would raise.
  if (
    !(await deps.pathExists(
      path.join(ctx.projectRoot, "reviewer", "SIMULATED_EXTERNAL_REVIEW.md")
    ))
  ) {
    missing.push(
      "{PROJ}/reviewer/SIMULATED_EXTERNAL_REVIEW.md — run simulated external review before SUBMIT"
    );
  }

  appendTopTierOpportunitySignals({
    missing,
    manifest: ctx.manifest,
    deps,
  });
  appendTopTierDeliverySignals({
    missing,
    manifest: ctx.manifest,
    phase: "submit",
    deps,
  });

  return missing;
}
