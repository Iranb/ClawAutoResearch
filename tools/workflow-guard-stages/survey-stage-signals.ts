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
  const reviewProtocolResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.reviewProtocolPath
  );
  const sotaMatrixResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.sotaMatrixPath
  );
  const coverageSummaryResolvedPath = params.deps.resolveProjectArtifactPath(
    params.projectRoot,
    state.coverageSummaryPath
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

  const queryRegistryReady =
    !requiresQueryRegistry ||
    (await params.deps.fileHasMeaningfulJsonContent(queryRegistryResolvedPath));
  const includedReady =
    !requiresScreeningPacket ||
    (await params.deps.fileHasMeaningfulJsonContent(includedResolvedPath));
  const excludedReady =
    !requiresScreeningPacket ||
    (await params.deps.fileHasMeaningfulJsonContent(excludedResolvedPath));
  const literatureReviewReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasNonWhitespaceContent(literatureReviewResolvedPath));
  const gapReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasNonWhitespaceContent(gapResolvedPath));
  const surveyBriefReady =
    !requiresSurveyBrief ||
    (await params.deps.fileHasNonWhitespaceContent(surveyBriefResolvedPath));
  const reviewProtocolReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasNonWhitespaceContent(reviewProtocolResolvedPath));
  const sotaMatrixReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasNonWhitespaceContent(sotaMatrixResolvedPath));
  const coverageSummaryReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasNonWhitespaceContent(coverageSummaryResolvedPath));
  const diagnosticsReady =
    !requiresSynthesisPacket ||
    (await params.deps.fileHasMeaningfulJsonContent(diagnosticsResolvedPath));

  const artifactCompleteForWrite =
    queryRegistryReady &&
    includedReady &&
    excludedReady &&
    literatureReviewReady &&
    gapReady &&
    surveyBriefReady &&
    reviewProtocolReady &&
    sotaMatrixReady &&
    coverageSummaryReady &&
    diagnosticsReady &&
    state.gateBlockingIssues.length === 0;

  if (!artifactCompleteForWrite) {
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
    if ((state.pendingPlannedRoundCount ?? 0) > 0) {
      missing.push(
        `survey_review still has ${state.pendingPlannedRoundCount} pending retrieval round(s)`
      );
    }
    if ((state.pendingScreeningCount ?? 0) > 0) {
      missing.push(
        `survey_review still has ${state.pendingScreeningCount} pending screening candidate(s)`
      );
    }
  }

  if (!queryRegistryReady) {
    missing.push(
      `${state.queryRegistryPath ?? "researcher/SURVEY_QUERY_REGISTRY.json"} should record one or more retrieval rounds`
    );
  }
  if (!includedReady) {
    missing.push(
      `${state.includedPapersPath ?? "researcher/INCLUDED_PAPERS.json"} should list the included survey papers`
    );
  }
  if (!excludedReady) {
    missing.push(
      `${state.excludedPapersPath ?? "researcher/EXCLUDED_PAPERS.json"} should list excluded/background-only survey candidates`
    );
  }
  if (!literatureReviewReady) {
    missing.push(
      `${state.literatureReviewPath ?? "researcher/LITERATURE_REVIEW.md"} is required before the survey brief can be finalized`
    );
  }
  if (!gapReady) {
    missing.push(
      `${state.gapSynthesisPath ?? "researcher/GAP_SYNTHESIS.md"} is required before the survey brief can be finalized`
    );
  }
  if (!surveyBriefReady) {
    missing.push(
      `${state.surveyBriefPath ?? "researcher/SURVEY_BRIEF.md"} is required when survey_review.status=completed`
    );
  }
  if (!reviewProtocolReady) {
    missing.push(
      `${state.reviewProtocolPath ?? "researcher/REVIEW_PROTOCOL.md"} should make dataset / metric alignment explicit before write handoff`
    );
  }
  if (!sotaMatrixReady) {
    missing.push(
      `${state.sotaMatrixPath ?? "researcher/SOTA_MATRIX.md"} should summarize representative methods before write handoff`
    );
  }
  if (!coverageSummaryReady) {
    missing.push(
      `${state.coverageSummaryPath ?? "researcher/COVERAGE_SUMMARY.md"} should summarize search breadth, scope boundaries, and blind spots`
    );
  }
  if (!diagnosticsReady) {
    missing.push(
      `${state.diagnosticsPath ?? "researcher/SURVEY_GATE_DIAGNOSTICS.json"} should record the survey-quality gate diagnostics`
    );
  }
  return missing;
}
