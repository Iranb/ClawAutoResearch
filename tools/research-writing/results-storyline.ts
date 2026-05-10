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
import {
  getPromptText,
  loadWorkflowPromptConfig,
  renderPromptTemplate,
  type WorkflowPromptConfig,
} from "../workflow-prompt-config";
import { normalizeSurveyStorylinePacket } from "./survey-storyline";

function nowIso(): string {
  return new Date().toISOString();
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

function configuredPromptText(
  config: WorkflowPromptConfig | null | undefined,
  pathParts: string[],
  fallback: string,
  values: Record<string, unknown> = {}
): string {
  return renderPromptTemplate(getPromptText(config, pathParts, fallback), values);
}

function makeExperimentQuestions(params: {
  primaryMetric: string | null;
  baselineReference: string | null;
  claimIds: string[];
  figureTableIds: string[];
  unsupportedClaimsText: string | null;
  trackVerdictsText: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): ResultsStorylineQuestion[] {
  const primaryMetric = params.primaryMetric ?? "the primary metric";
  const baselineReference = params.baselineReference ?? "the strongest named baseline";
  const promptValues = {
    primaryMetric,
    baselineReference,
  };
  const configRoot = ["paperWriting", "resultsStoryline", "experimentQuestions"];
  const failureKnown = /fail|boundary|limitation|unsupported/i.test(
    `${params.unsupportedClaimsText ?? ""}\n${params.trackVerdictsText ?? ""}`
  );
  const ids = params.claimIds;
  const visuals = params.figureTableIds;
  return [
    {
      questionId: "effectiveness",
      sectionId: null,
      prompt: configuredPromptText(
        params.promptConfig,
        [...configRoot, "effectiveness", "prompt"],
        "Does the method improve {{primaryMetric}} over {{baselineReference}}?",
        promptValues
      ),
      objective: configuredPromptText(
        params.promptConfig,
        [...configRoot, "effectiveness", "objective"],
        "Open Results with the cleanest effectiveness question before diving into mechanism or nuance.",
        promptValues
      ),
      evidenceIds: ids.slice(0, 2),
      figureTableIds: visuals.slice(0, 2),
      tensionIds: [],
      answerStatus: ids.length > 0 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "mechanism",
      sectionId: null,
      prompt: configuredPromptText(
        params.promptConfig,
        [...configRoot, "mechanism", "prompt"],
        "What mechanism explains the observed gain?",
        promptValues
      ),
      objective: configuredPromptText(
        params.promptConfig,
        [...configRoot, "mechanism", "objective"],
        "Make the causal or structural mechanism explicit instead of leaving the gain as a black-box empirical win.",
        promptValues
      ),
      evidenceIds: ids.slice(0, 3),
      figureTableIds: visuals.slice(1, 3),
      tensionIds: [],
      answerStatus: ids.length > 1 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "baseline",
      sectionId: null,
      prompt: configuredPromptText(
        params.promptConfig,
        [...configRoot, "baseline", "prompt"],
        "How does the method compare against {{baselineReference}} under the fairest shared protocol?",
        promptValues
      ),
      objective: configuredPromptText(
        params.promptConfig,
        [...configRoot, "baseline", "objective"],
        "Prevent the strongest-baseline comparison from being buried or deferred.",
        promptValues
      ),
      evidenceIds: ids.slice(0, 2),
      figureTableIds: visuals
        .filter((entry) => /^table/i.test(entry) || /^tab:/i.test(entry))
        .slice(0, 2),
      tensionIds: [],
      answerStatus: ids.length > 0 ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "boundary",
      sectionId: null,
      prompt: configuredPromptText(
        params.promptConfig,
        [...configRoot, "boundary", "prompt"],
        "Where does the method fail, require qualification, or become brittle?",
        promptValues
      ),
      objective: configuredPromptText(
        params.promptConfig,
        [...configRoot, "boundary", "objective"],
        "Force boundary conditions into the main Results arc instead of leaving them to reviewer pressure or limitations alone.",
        promptValues
      ),
      evidenceIds: ids.slice(-2),
      figureTableIds: visuals.slice(2, 4),
      tensionIds: [],
      answerStatus: failureKnown ? "supported" : "partial",
      searchRequired: false,
    },
    {
      questionId: "robustness_cost",
      sectionId: null,
      prompt: configuredPromptText(
        params.promptConfig,
        [...configRoot, "robustnessCost", "prompt"],
        "What is the robustness, cost, or scalability trade-off once the main effect is established?",
        promptValues
      ),
      objective: configuredPromptText(
        params.promptConfig,
        [...configRoot, "robustnessCost", "objective"],
        "Close the Results arc with practical trade-offs instead of an isolated final benchmark dump.",
        promptValues
      ),
      evidenceIds: ids.slice(-2),
      figureTableIds: visuals.slice(3, 5),
      tensionIds: [],
      answerStatus: visuals.length >= 3 ? "supported" : "partial",
      searchRequired: false,
    },
  ];
}

function makeSurveyQuestions(params: {
  topic: string | null;
  figureTableIds: string[];
  supportPacket: ReturnType<typeof normalizeSurveyStorylinePacket>;
  promptConfig?: WorkflowPromptConfig | null;
}): ResultsStorylineQuestion[] {
  const topic = params.topic ?? "the survey topic";
  const packet = params.supportPacket;
  const promptValues = { topic };
  const configRoot = ["paperWriting", "resultsStoryline", "surveyFallbackQuestions"];
  if (!packet || packet.sectionPlans.length === 0) {
    return [
      {
        questionId: "scope_protocol",
        sectionId: "scope_and_protocol",
        prompt: configuredPromptText(
          params.promptConfig,
          [...configRoot, "scopeProtocol", "prompt"],
          "What is the survey scope and protocol for {{topic}}?",
          promptValues
        ),
        objective: configuredPromptText(
          params.promptConfig,
          [...configRoot, "scopeProtocol", "objective"],
          "Start with inclusion, exclusion, and retrieval discipline before synthesis claims.",
          promptValues
        ),
        evidenceIds: ["survey:scope", "survey:protocol"],
        figureTableIds: params.figureTableIds.slice(0, 1),
        tensionIds: [],
        answerStatus: "supported",
        searchRequired: false,
      },
      {
        questionId: "taxonomy",
        sectionId: "taxonomy",
        prompt: configuredPromptText(
          params.promptConfig,
          [...configRoot, "taxonomy", "prompt"],
          "How should the field around {{topic}} be organized into stable families or themes?",
          promptValues
        ),
        objective: configuredPromptText(
          params.promptConfig,
          [...configRoot, "taxonomy", "objective"],
          "Turn the literature into a durable structure instead of a paper list.",
          promptValues
        ),
        evidenceIds: ["survey:taxonomy"],
        figureTableIds: params.figureTableIds.slice(0, 2),
        tensionIds: [],
        answerStatus: "supported",
        searchRequired: false,
      },
      {
        questionId: "evidence_synthesis",
        sectionId: "evidence_synthesis",
        prompt: configuredPromptText(
          params.promptConfig,
          [...configRoot, "evidenceSynthesis", "prompt"],
          "What does the comparative evidence actually support across those families?",
          promptValues
        ),
        objective: configuredPromptText(
          params.promptConfig,
          [...configRoot, "evidenceSynthesis", "objective"],
          "Synthesize comparable findings before moving to benchmark landscape or open problems.",
          promptValues
        ),
        evidenceIds: ["survey:evidence_synthesis"],
        figureTableIds: params.figureTableIds.slice(1, 3),
        tensionIds: [],
        answerStatus: "supported",
        searchRequired: false,
      },
      {
        questionId: "benchmark_landscape",
        sectionId: "benchmark_landscape",
        prompt: configuredPromptText(
          params.promptConfig,
          [...configRoot, "benchmarkLandscape", "prompt"],
          "Which benchmark and evaluation patterns are genuinely comparable, and where are they not?",
          promptValues
        ),
        objective: configuredPromptText(
          params.promptConfig,
          [...configRoot, "benchmarkLandscape", "objective"],
          "Keep benchmark landscape honest about incompatibilities and evaluation drift.",
          promptValues
        ),
        evidenceIds: ["survey:benchmark_landscape"],
        figureTableIds: params.figureTableIds.slice(2, 4),
        tensionIds: [],
        answerStatus: "supported",
        searchRequired: false,
      },
      {
        questionId: "open_problems",
        sectionId: "open_problems",
        prompt: configuredPromptText(
          params.promptConfig,
          [...configRoot, "openProblems", "prompt"],
          "What open problems and disagreement zones remain once the comparative landscape is mapped?",
          promptValues
        ),
        objective: configuredPromptText(
          params.promptConfig,
          [...configRoot, "openProblems", "objective"],
          "End with explicit unresolved gaps instead of vague future-work filler.",
          promptValues
        ),
        evidenceIds: ["survey:open_problems"],
        figureTableIds: params.figureTableIds.slice(3, 5),
        tensionIds: [],
        answerStatus: "supported",
        searchRequired: false,
      },
    ];
  }

  const sectionPlans = packet.sectionPlans;
  return sectionPlans.map((plan, index) => {
    const visuals =
      plan.sectionId === packet.intellectualCenterSection
        ? params.figureTableIds.slice(Math.max(0, index - 1), Math.max(0, index - 1) + 3)
        : params.figureTableIds.slice(index, index + 2);
    return {
      questionId: plan.sectionId,
      sectionId: plan.sectionId,
      prompt: plan.prompt,
      objective: plan.objective,
      evidenceIds: uniqueStrings([
        ...plan.evidenceClusterIds,
        ...plan.anchorIds,
      ]),
      figureTableIds: visuals,
      tensionIds: plan.tensionIds,
      answerStatus:
        plan.anchorIds.length > 0 || plan.evidenceClusterIds.length > 0 ? "supported" : "partial",
      searchRequired: false,
    };
  });
}

function renderMarkdown(params: {
  workflowLine: "experiment" | "survey";
  questions: ResultsStorylineQuestion[];
  state: Pick<
    ResultsStorylineState,
    "storyStrategy" | "storyStrategyRationale" | "storyThesis" | "intellectualCenterSection"
  >;
  promptConfig?: WorkflowPromptConfig | null;
}): string {
  const intro =
    params.workflowLine === "survey"
      ? getPromptText(
          params.promptConfig,
          ["paperWriting", "resultsStoryline", "markdownIntro", "survey"],
          "Use this file as the survey synthesis order: the section sequence should answer field-structure questions in reviewer-readable order."
        )
      : getPromptText(
          params.promptConfig,
          ["paperWriting", "resultsStoryline", "markdownIntro", "experiment"],
          "Use this file as the Results argument order: the section sequence should answer reviewer questions, not mirror experiment execution order."
        );
  const surveyHeader =
    params.workflowLine === "survey"
      ? [
          params.state.storyStrategy
            ? `- story_strategy: ${params.state.storyStrategy}`
            : null,
          params.state.intellectualCenterSection
            ? `- intellectual_center_section: ${params.state.intellectualCenterSection}`
            : null,
          params.state.storyThesis
            ? `- story_thesis: ${params.state.storyThesis}`
            : null,
          ...(params.state.storyStrategyRationale.length > 0
            ? ["", "## Strategy Rationale", ...params.state.storyStrategyRationale.map((entry) => `- ${entry}`)]
            : []),
        ].filter((entry): entry is string => Boolean(entry))
      : [];
  return [
    getPromptText(
      params.promptConfig,
      ["paperWriting", "resultsStoryline", "markdownHeading"],
      "# Results Question Order"
    ),
    "",
    intro,
    ...(surveyHeader.length > 0 ? ["", ...surveyHeader] : []),
    "",
    ...params.questions.map((entry, index) =>
      [
        `## ${index + 1}. ${entry.prompt ?? entry.questionId}`,
        `- section_id: ${entry.sectionId ?? "unset"}`,
        `- objective: ${entry.objective ?? "unset"}`,
        `- evidence_ids: ${entry.evidenceIds.join(", ") || "unset"}`,
        `- figure_table_ids: ${entry.figureTableIds.join(", ") || "unset"}`,
        `- tension_ids: ${entry.tensionIds.join(", ") || "unset"}`,
        `- answer_status: ${entry.answerStatus}`,
      ].join("\n")
    ),
  ].join("\n\n");
}

export async function materializeResultsStoryline(params: {
  projectRoot: string;
  stage?: string | null;
  promptConfigPath?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): Promise<{
  state: ResultsStorylineState;
  generatedFiles: string[];
}> {
  const promptConfig =
    params.promptConfig ??
    loadWorkflowPromptConfig({ configPath: params.promptConfigPath ?? null });
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
    surveyStorylinePacketRaw,
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
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, paperStory.surveyStorylinePacketPath) ?? ""
    ),
  ]);

  const claimIds = extractClaimIds(`${claimMapText ?? ""}\n${claimEvidenceMatrixText ?? ""}`);
  const figureTableIds = extractFigureTableIds(figureTableAlignmentText);
  const supportPacket = normalizeSurveyStorylinePacket(surveyStorylinePacketRaw);
  const questions =
    workflowLine === "survey"
      ? makeSurveyQuestions({
          topic:
            supportPacket?.topic ??
            firstMeaningfulLine(surveyBriefsText, surveyComparativeText, surveySelfReviewText) ??
            researchProgram.goal,
          figureTableIds,
          supportPacket,
          promptConfig,
        })
      : makeExperimentQuestions({
          primaryMetric: researchProgram.primaryMetric,
          baselineReference: researchProgram.baselineReference,
          claimIds,
          figureTableIds,
          unsupportedClaimsText,
          trackVerdictsText,
          promptConfig,
        });

  const evidenceModules = uniqueStrings(questions.flatMap((entry) => entry.evidenceIds));
  const figureTableOrder = uniqueStrings(questions.flatMap((entry) => entry.figureTableIds));
  const hasCoreInputs =
    paperStory.status === "ready" &&
    (workflowLine === "survey"
      ? Boolean(
          supportPacket ||
            surveyBriefsText ||
            surveyComparativeText ||
            surveySelfReviewText
        )
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
    storyStrategy: supportPacket?.selectedStrategyId ?? null,
    intellectualCenterSection: supportPacket?.intellectualCenterSection ?? null,
    questions: questions.map((entry) => ({
      questionId: entry.questionId,
      sectionId: entry.sectionId,
      prompt: entry.prompt,
      evidenceIds: entry.evidenceIds,
      figureTableIds: entry.figureTableIds,
      tensionIds: entry.tensionIds,
      answerStatus: entry.answerStatus,
    })),
  });

  const state = normalizeResultsStorylineState({
    ...serializeResultsStorylineState(current),
    status,
    workflow_line: workflowLine,
    story_strategy: supportPacket?.selectedStrategyId ?? current.storyStrategy,
    story_strategy_rationale:
      supportPacket?.selectedStrategyRationale ?? current.storyStrategyRationale,
    story_thesis: supportPacket?.thesis ?? current.storyThesis,
    intellectual_center_section:
      supportPacket?.intellectualCenterSection ?? current.intellectualCenterSection,
    support_packet_path:
      supportPacket ? paperStory.surveyStorylinePacketPath : current.supportPacketPath,
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
      `${renderMarkdown({
        workflowLine,
        questions,
        state,
        promptConfig,
      })}\n`
    );
    generatedFiles.push(state.resultsQuestionOrderPath ?? "");
  }
  if (evidenceSequencePath) {
    await writeJsonEnsured(evidenceSequencePath, {
      schemaVersion: 1,
      workflowLine,
      story_strategy: state.storyStrategy,
      story_thesis: state.storyThesis,
      intellectual_center_section: state.intellectualCenterSection,
      support_packet_path: state.supportPacketPath,
      storylineFingerprint,
      questions: questions.map((entry, index) => ({
        order: index + 1,
        question_id: entry.questionId,
        section_id: entry.sectionId,
        prompt: entry.prompt,
        objective: entry.objective,
        evidence_ids: entry.evidenceIds,
        figure_table_ids: entry.figureTableIds,
        tension_ids: entry.tensionIds,
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
