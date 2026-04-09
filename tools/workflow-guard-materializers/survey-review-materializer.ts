import * as path from "node:path";
import {
  asRecord,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  getSurveyReviewStateSummary,
  normalizeSurveyReviewState,
  serializeSurveyReviewState,
  type SurveyReviewState,
} from "../workflow-guard-state/survey-review";

function countPaperEntries(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  if (Array.isArray(record.papers)) {
    return record.papers.length;
  }
  if (Array.isArray(record.included)) {
    return record.included.length;
  }
  if (Array.isArray(record.excluded)) {
    return record.excluded.length;
  }
  return 0;
}

function countQueryRounds(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  if (Array.isArray(record.rounds)) {
    return record.rounds.length;
  }
  if (Array.isArray(record.queries)) {
    return record.queries.length;
  }
  return 0;
}

async function hasNonWhitespaceContent(filePath: string | null): Promise<boolean> {
  const text = await readTextIfExists(filePath);
  return Boolean(text && text.trim().length > 0);
}

export async function materializeSurveyReviewStateImpl(params: {
  projectRoot: string;
  surveyReviewMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: SurveyReviewState;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeSurveyReviewState(manifest.survey_review);
  const patch = asRecord(params.surveyReviewMaterialization) ?? {};
  const merged = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(current),
    ...patch,
  });

  const [
    queryRegistry,
    includedJson,
    excludedJson,
    literatureExists,
    literatureReviewExists,
    protocolExists,
    sotaExists,
    gapExists,
    coverageExists,
    surveyBriefExists,
  ] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.queryRegistryPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.includedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.excludedPapersPath) ?? ""
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.literaturePath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.literatureReviewPath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.reviewProtocolPath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.sotaMatrixPath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.gapSynthesisPath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.coverageSummaryPath)
    ),
    hasNonWhitespaceContent(
      resolveProjectArtifactPath(projectRoot, merged.surveyBriefPath)
    ),
  ]);

  const queryRoundCount = countQueryRounds(queryRegistry);
  const includedPaperCount = countPaperEntries(includedJson);
  const excludedPaperCount = countPaperEntries(excludedJson);
  const candidatePaperCount =
    typeof (queryRegistry as Record<string, unknown> | null)?.candidate_paper_count ===
    "number"
      ? Math.max(
          includedPaperCount + excludedPaperCount,
          Number((queryRegistry as Record<string, unknown>).candidate_paper_count)
        )
      : Math.max(
          includedPaperCount + excludedPaperCount,
          merged.candidatePaperCount ?? 0
        );

  let status = merged.status;
  let currentPhase = merged.currentPhase;
  let pendingReason = merged.pendingReason;

  if (surveyBriefExists) {
    status = "completed";
    currentPhase = "complete";
    pendingReason = null;
  } else if (literatureReviewExists || sotaExists || gapExists) {
    status = "synthesizing";
    currentPhase = "synthesis";
    pendingReason = surveyBriefExists ? null : "Finalize the survey brief.";
  } else if (protocolExists || includedPaperCount > 0 || excludedPaperCount > 0) {
    status = "screening";
    currentPhase = "screening";
    pendingReason = "Finish screening and synthesize the review packet.";
  } else if (queryRoundCount > 0 || literatureExists) {
    status = "searching";
    currentPhase = "retrieval";
    pendingReason = "Continue broad retrieval until the review packet can be screened.";
  } else {
    status = "missing";
    currentPhase = "bootstrap";
    pendingReason = "Start the survey retrieval rounds.";
  }

  const next = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(merged),
    status,
    current_phase: currentPhase,
    query_round_count: queryRoundCount,
    candidate_paper_count: candidatePaperCount,
    included_paper_count: includedPaperCount,
    excluded_paper_count: excludedPaperCount,
    graph_grounded_brief_ready:
      surveyBriefExists || (coverageExists && literatureReviewExists && gapExists),
    pending_reason: pendingReason,
    last_updated_at: new Date().toISOString(),
  });

  manifest.survey_review = serializeSurveyReviewState(next);
  manifest.current_stage = "survey_review";
  manifest.current_micro_stage = next.currentPhase ?? "survey_requested";
  manifest.owner_agent = "researcher";
  await writeJsonEnsured(manifestPath, manifest);

  return {
    state: getSurveyReviewStateSummary(manifest).state,
    generatedFiles: [],
  };
}
