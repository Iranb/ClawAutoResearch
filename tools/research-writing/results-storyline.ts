import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  normalizeResultsStorylineState,
  serializeResultsStorylineState,
  type ResultsStorylineQuestion,
  type ResultsStorylineState,
} from "../workflow-guard-state/results-storyline";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStage(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function collectSignalLines(rawText: string | null | undefined, limit = 8): string[] {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+/, ""))
    .slice(0, limit);
}

function firstMeaningfulLine(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const line = collectSignalLines(value, 1)[0] ?? null;
    if (line) {
      return line;
    }
  }
  return null;
}

function extractClaimIds(text: string | null | undefined): string[] {
  return uniqueStrings((String(text ?? "").match(/claim-[a-z0-9-]+/gi) ?? []).map(String));
}

function extractFigureTableIds(text: string | null | undefined): string[] {
  return uniqueStrings(
    (
      String(text ?? "").match(
        /\b(?:fig|tab):[a-z0-9_-]+\b|\b(?:Figure|Fig\.|Table)\s+\d+\b/gi
      ) ?? []
    ).map(String)
  );
}

function buildFingerprint(value: unknown): string {
  return `sha1:${createHash("sha1").update(JSON.stringify(value)).digest("hex")}`;
}

function makeExperimentQuestions(params: {
  primaryMetric: string | null;
  baselineReference: string | null;
  claimIds: string[];
  figureTableIds: string[];
  unsupportedClaimsText: string | null;
  trackVerdictsText: string | null;
}): ResultsStorylineQuestion[] {
  const primaryMetric = params.primaryMetric ?? "the primary metric";
  const baselineReference = params.baselineReference ?? "the strongest named baseline";
  const failureKnown = /fail|boundary|limitation|unsupported/i.test(
    `${params.unsupportedClaimsText ?? ""}\n${params.trackVerdictsText ?? ""}`
  );
  const ids = params.claimIds;
  const visuals = params.figureTableIds;
  return [
    {
      questionId: "effectiveness",
      prompt: `Does the method improve ${primaryMetric} over ${baselineReference}?`,
      objective: "Open Results with the cleanest effectiveness question before diving into mechanism or nuance.",
      evidenceIds: ids.slice(0, 2),
      figureTableIds: visuals.slice(0, 2),
      answerStatus: ids.length > 0 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "mechanism",
      prompt: "What mechanism explains the observed gain?",
      objective: "Make the causal or structural mechanism explicit instead of leaving the gain as a black-box empirical win.",
      evidenceIds: ids.slice(0, 3),
      figureTableIds: visuals.slice(1, 3),
      answerStatus: ids.length > 1 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "baseline",
      prompt: `How does the method compare against ${baselineReference} under the fairest shared protocol?`,
      objective: "Prevent the strongest-baseline comparison from being buried or deferred.",
      evidenceIds: ids.slice(0, 2),
      figureTableIds: visuals.filter((entry) => /^table/i.test(entry) || /^tab:/i.test(entry)).slice(0, 2),
      answerStatus: ids.length > 0 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "boundary",
      prompt: "Where does the method fail, require qualification, or become brittle?",
      objective: "Force boundary conditions into the main Results arc instead of leaving them to reviewer pressure or limitations alone.",
      evidenceIds: ids.slice(-2),
      figureTableIds: visuals.slice(2, 4),
      answerStatus: failureKnown ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "robustness_cost",
      prompt: "What is the robustness, cost, or scalability trade-off once the main effect is established?",
      objective: "Close the Results arc with practical trade-offs instead of an isolated final benchmark dump.",
      evidenceIds: ids.slice(-2),
      figureTableIds: visuals.slice(3, 5),
      answerStatus: visuals.length >= 3 ? "supported" : "partial",
      searchRequired: false,
    },
  ];
}

function makeSurveyQuestions(params: {
  topic: string | null;
  figureTableIds: string[];
}): ResultsStorylineQuestion[] {
  const topic = params.topic ?? "the survey topic";
  return [
    {
      questionId: "scope_protocol",
      prompt: `What is the survey scope and protocol for ${topic}?`,
      objective: "Start with inclusion, exclusion, and retrieval discipline before synthesis claims.",
      evidenceIds: ["survey:scope", "survey:protocol"],
      figureTableIds: params.figureTableIds.slice(0, 1),
      answerStatus: "supported",
      searchRequired: false,
    },
    {
      questionId: "taxonomy",
      prompt: `How should the field around ${topic} be organized into stable families or themes?`,
      objective: "Turn the literature into a durable structure instead of a paper list.",
      evidenceIds: ["survey:taxonomy"],
      figureTableIds: params.figureTableIds.slice(0, 2),
      answerStatus: "supported",
      searchRequired: false,
    },
    {
      questionId: "evidence_synthesis",
      prompt: "What does the comparative evidence actually support across those families?",
      objective: "Synthesize comparable findings before moving to benchmark landscape or open problems.",
      evidenceIds: ["survey:evidence_synthesis"],
      figureTableIds: params.figureTableIds.slice(1, 3),
      answerStatus: "supported",
      searchRequired: false,
    },
    {
      questionId: "benchmark_landscape",
      prompt: "Which benchmark and evaluation patterns are genuinely comparable, and where are they not?",
      objective: "Keep benchmark landscape honest about incompatibilities and evaluation drift.",
      evidenceIds: ["survey:benchmark_landscape"],
      figureTableIds: params.figureTableIds.slice(2, 4),
      answerStatus: "supported",
      searchRequired: false,
    },
    {
      questionId: "open_problems",
      prompt: "What open problems and disagreement zones remain once the comparative landscape is mapped?",
      objective: "End with explicit unresolved gaps instead of vague future-work filler.",
      evidenceIds: ["survey:open_problems"],
      figureTableIds: params.figureTableIds.slice(3, 5),
      answerStatus: "supported",
      searchRequired: false,
    },
  ];
}

function renderMarkdown(params: {
  workflowLine: "experiment" | "survey";
  questions: ResultsStorylineQuestion[];
}): string {
  const intro =
    params.workflowLine === "survey"
      ? "Use this file as the survey synthesis order: the section sequence should answer field-structure questions in reviewer-readable order."
      : "Use this file as the Results argument order: the section sequence should answer reviewer questions, not mirror experiment execution order.";
  return [
    "# Results Question Order",
    "",
    intro,
    "",
    ...params.questions.map((entry, index) =>
      [
        `## ${index + 1}. ${entry.prompt ?? entry.questionId}`,
        `- objective: ${entry.objective ?? "unset"}`,
        `- evidence_ids: ${entry.evidenceIds.join(", ") || "unset"}`,
        `- figure_table_ids: ${entry.figureTableIds.join(", ") || "unset"}`,
        `- answer_status: ${entry.answerStatus}`,
      ].join("\n")
    ),
  ].join("\n\n");
}

export async function materializeResultsStoryline(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: ResultsStorylineState;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeResultsStorylineState(manifest.results_storyline);
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const workflowLine =
    manifest.workflow_line === "survey" ||
    writingContract.paperMode === "survey"
      ? "survey"
      : "experiment";

  const [
    claimMapText,
    claimEvidenceMatrixText,
    unsupportedClaimsText,
    figureTableAlignmentText,
    trackVerdictsText,
    surveyBriefsText,
    surveyComparativeText,
    surveySelfReviewText,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.claimToExperimentMapPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.claimEvidenceMatrixPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.unsupportedClaimsPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/FIGURE_TABLE_ALIGNMENT.md")
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.trackVerdictsPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/SURVEY_SECTION_BRIEFS.md")
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md")
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/SURVEY_SELF_REVIEW.md")
    ),
  ]);

  const claimIds = extractClaimIds(`${claimMapText ?? ""}\n${claimEvidenceMatrixText ?? ""}`);
  const figureTableIds = extractFigureTableIds(figureTableAlignmentText);
  const questions =
    workflowLine === "survey"
      ? makeSurveyQuestions({
          topic:
            firstMeaningfulLine(surveyBriefsText, surveyComparativeText, surveySelfReviewText) ??
            researchProgram.goal,
          figureTableIds,
        })
      : makeExperimentQuestions({
          primaryMetric: researchProgram.primaryMetric,
          baselineReference: researchProgram.baselineReference,
          claimIds,
          figureTableIds,
          unsupportedClaimsText,
          trackVerdictsText,
        });

  const evidenceModules = uniqueStrings(
    questions.flatMap((entry) => entry.evidenceIds)
  );
  const figureTableOrder = uniqueStrings(
    questions.flatMap((entry) => entry.figureTableIds)
  );
  const hasCoreInputs =
    paperStory.status === "ready" &&
    (workflowLine === "survey"
      ? Boolean(surveyBriefsText || surveyComparativeText || surveySelfReviewText)
      : Boolean(claimMapText && claimEvidenceMatrixText));
  const status =
    hasCoreInputs && questions.length > 0
      ? "ready"
      : questions.length > 0
        ? "draft"
        : "missing";
  const pendingReason =
    hasCoreInputs
      ? null
      : workflowLine === "survey"
        ? "Survey synthesis artifacts are still too thin to stabilize the results storyline."
        : "Claim-to-experiment and claim-evidence artifacts are still too thin to stabilize the results storyline.";
  const storylineFingerprint = buildFingerprint({
    workflowLine,
    questions: questions.map((entry) => ({
      questionId: entry.questionId,
      prompt: entry.prompt,
      evidenceIds: entry.evidenceIds,
      figureTableIds: entry.figureTableIds,
      answerStatus: entry.answerStatus,
    })),
  });

  const state = normalizeResultsStorylineState({
    ...serializeResultsStorylineState(current),
    status,
    workflow_line: workflowLine,
    question_order: questions,
    evidence_modules: evidenceModules,
    figure_table_order: figureTableOrder,
    pending_reason: pendingReason,
    storyline_fingerprint: storylineFingerprint,
    last_updated_at: nowIso(),
  });

  const questionOrderPath = resolveProjectArtifactPath(
    projectRoot,
    state.resultsQuestionOrderPath
  );
  const evidenceSequencePath = resolveProjectArtifactPath(
    projectRoot,
    state.experimentEvidenceSequencePath
  );
  const generatedFiles: string[] = [];
  if (questionOrderPath) {
    await writeTextEnsured(
      questionOrderPath,
      `${renderMarkdown({ workflowLine, questions })}\n`
    );
    generatedFiles.push(state.resultsQuestionOrderPath ?? "");
  }
  if (evidenceSequencePath) {
    await writeJsonEnsured(evidenceSequencePath, {
      schemaVersion: 1,
      workflowLine,
      storylineFingerprint,
      questions: questions.map((entry, index) => ({
        order: index + 1,
        question_id: entry.questionId,
        prompt: entry.prompt,
        objective: entry.objective,
        evidence_ids: entry.evidenceIds,
        figure_table_ids: entry.figureTableIds,
        answer_status: entry.answerStatus,
        search_required: entry.searchRequired,
      })),
    });
    generatedFiles.push(state.experimentEvidenceSequencePath ?? "");
  }

  const nextManifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? manifest;
  nextManifest.results_storyline = serializeResultsStorylineState(state);
  await writeJsonEnsured(manifestPath, nextManifest);

  return {
    state,
    generatedFiles: uniqueStrings(generatedFiles),
  };
}
