import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";

type ManifestLike = Record<string, unknown>;

export type SurveyStageSignalDeps = {
  resolveProjectArtifactPath: (projectRoot: string, artifactPath: string | null) => string | null;
  fileHasMeaningfulJsonContent: (targetPath: string | null) => Promise<boolean>;
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
};

export async function collectSurveyReviewStageMissingSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
  deps: SurveyStageSignalDeps;
}): Promise<string[]> {
  const state = normalizeSurveyReviewState(params.manifest?.survey_review);
  const missing: string[] = [];
  if (!state.topic) {
    missing.push("PROJECT_MANIFEST.json.survey_review.topic is required");
  }
  if (state.status !== "completed") {
    missing.push(
      state.pendingReason
        ? `survey_review must reach completed before WRITE handoff: ${state.pendingReason}`
        : `survey_review must reach completed before WRITE handoff (current: ${state.status})`
    );
  }
  if (!state.gateReady) {
    missing.push(
      `survey_review quality gates must be ready before WRITE handoff: coverage=${state.coverageStatus ?? "missing"}, taxonomy=${state.taxonomyStabilityStatus ?? "missing"}, representative_methods=${state.representativeMethodsStatus ?? "missing"}, benchmark_alignment=${state.benchmarkAlignmentStatus ?? "missing"}, gap_closure=${state.gapClosureStatus ?? "missing"}`
    );
  }
  if (state.coverageStatus !== "ready") {
    missing.push(
      state.coverageSummary
        ? `survey coverage gate is not ready: ${state.coverageSummary}`
        : "survey coverage gate is not ready"
    );
  }
  if (state.taxonomyStabilityStatus !== "stable") {
    missing.push(
      state.taxonomyStabilitySummary
        ? `survey taxonomy gate is not stable: ${state.taxonomyStabilitySummary}`
        : "survey taxonomy gate is not stable"
    );
  }
  if (state.representativeMethodsStatus !== "ready") {
    missing.push(
      state.representativeMethodsSummary
        ? `survey representative-methods gate is not ready: ${state.representativeMethodsSummary}`
        : "survey representative-methods gate is not ready"
    );
  }
  if (state.benchmarkAlignmentStatus !== "aligned") {
    missing.push(
      state.benchmarkAlignmentSummary
        ? `survey benchmark-alignment gate is not aligned: ${state.benchmarkAlignmentSummary}`
        : "survey benchmark-alignment gate is not aligned"
    );
  }
  if (state.gapClosureStatus !== "closed") {
    missing.push(
      state.gapClosureSummary
        ? `survey gap-closure gate is not closed: ${state.gapClosureSummary}`
        : "survey gap-closure gate is not closed"
    );
  }
  if (state.gateBlockingIssues.length > 0) {
    missing.push(`survey_review blocking issues: ${state.gateBlockingIssues.join(" | ")}`);
  }

  const queryRegistryResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.queryRegistryPath
  );
  const includedResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.includedPapersPath
  );
  const excludedResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.excludedPapersPath
  );
  const literatureReviewResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.literatureReviewPath
  );
  const gapResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.gapSynthesisPath
  );
  const surveyBriefResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.surveyBriefPath
  );
  const diagnosticsResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.diagnosticsPath
  );

  const requiresQueryRegistry = ["searching", "screening", "synthesizing", "completed"].includes(
    state.status
  );
  const requiresScreeningPacket = ["screening", "synthesizing", "completed"].includes(
    state.status
  );
  const requiresSynthesisPacket = ["synthesizing", "completed"].includes(state.status);
  const requiresSurveyBrief = state.status === "completed";

  if (
    requiresQueryRegistry &&
    !(await params.deps.fileHasMeaningfulJsonContent(queryRegistryResolvedPath))
  ) {
    missing.push(
      `${state.queryRegistryPath ?? "researcher/SURVEY_QUERY_REGISTRY.json"} should record one or more retrieval rounds`
    );
  }
  if (
    requiresScreeningPacket &&
    !(await params.deps.fileHasMeaningfulJsonContent(includedResolvedPath))
  ) {
    missing.push(
      `${state.includedPapersPath ?? "researcher/INCLUDED_PAPERS.json"} should list the included survey papers`
    );
  }
  if (
    requiresScreeningPacket &&
    !(await params.deps.fileHasMeaningfulJsonContent(excludedResolvedPath))
  ) {
    missing.push(
      `${state.excludedPapersPath ?? "researcher/EXCLUDED_PAPERS.json"} should list excluded/background-only survey candidates`
    );
  }
  if (
    requiresSynthesisPacket &&
    !(await params.deps.fileHasNonWhitespaceContent(literatureReviewResolvedPath))
  ) {
    missing.push(
      `${state.literatureReviewPath ?? "researcher/LITERATURE_REVIEW.md"} is required before the survey brief can be finalized`
    );
  }
  if (
    requiresSynthesisPacket &&
    !(await params.deps.fileHasNonWhitespaceContent(gapResolvedPath))
  ) {
    missing.push(
      `${state.gapSynthesisPath ?? "researcher/GAP_SYNTHESIS.md"} is required before the survey brief can be finalized`
    );
  }
  if (
    requiresSurveyBrief &&
    !(await params.deps.fileHasNonWhitespaceContent(surveyBriefResolvedPath))
  ) {
    missing.push(
      `${state.surveyBriefPath ?? "researcher/SURVEY_BRIEF.md"} is required when survey_review.status=completed`
    );
  }
  if (
    requiresSynthesisPacket &&
    !(await params.deps.fileHasMeaningfulJsonContent(diagnosticsResolvedPath))
  ) {
    missing.push(
      `${state.diagnosticsPath ?? "researcher/SURVEY_GATE_DIAGNOSTICS.json"} should record the survey-quality gate diagnostics`
    );
  }
  return missing;
}
