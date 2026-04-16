import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeInnovationSynthesisState } from "../workflow-guard-state/innovation-synthesis";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeResultsStorylineState } from "../workflow-guard-state/results-storyline";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import {
  normalizeTitleAbstractIntroWorkbenchState,
  serializeTitleAbstractIntroWorkbenchState,
  type TitleAbstractIntroWorkbenchState,
  type TitleCandidate,
} from "../workflow-guard-state/title-abstract-intro-workbench";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";

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

function sentenceCase(value: string | null | undefined, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }
  return raw.replace(/\s+/g, " ").replace(/\.$/, "");
}

function titleizeFragment(value: string | null | undefined, fallback: string): string {
  const raw = sentenceCase(value, fallback)
    .replace(/^the\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/^an\s+/i, "");
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function hasWeakTitlePattern(value: string): boolean {
  return /^(a study of|towards|an approach to|some notes on)\b/i.test(value.trim());
}

function buildFingerprint(value: unknown): string {
  return `sha1:${createHash("sha1").update(JSON.stringify(value)).digest("hex")}`;
}

function buildTitleCandidates(params: {
  workflowLine: "experiment" | "survey";
  problem: string | null;
  mechanism: string | null;
  outcome: string | null;
  implication: string | null;
}): TitleCandidate[] {
  const problem = titleizeFragment(params.problem, "Support Precision");
  const mechanism = titleizeFragment(params.mechanism, "Graph-Grounded Routing");
  const outcome = titleizeFragment(params.outcome, "Evidence-Aligned Narratives");
  const implication = titleizeFragment(params.implication, "Reviewer-Defensible Writing");
  const rawTitles =
    params.workflowLine === "survey"
      ? [
          `${problem}: A Survey of ${mechanism}`,
          `${mechanism} for ${problem}`,
          `${problem} Through ${mechanism}`,
          `${problem}: Benchmark Landscape, Taxonomy, and Open Problems`,
          `${mechanism}: A Structured Survey Lens for ${problem}`,
        ]
      : [
          `${mechanism} for ${problem}`,
          `${problem} Through ${mechanism}`,
          `${mechanism}: ${outcome} Without Losing ${implication}`,
          `${outcome} via ${mechanism}`,
          `${problem}: ${mechanism} as a Story-Aligned Evidence Layer`,
        ];
  return rawTitles.map((title, index) => {
    const riskFlags = hasWeakTitlePattern(title) ? ["weak_title_pattern"] : [];
    return {
      title,
      focus:
        index === 0
          ? "mechanism + problem"
          : index === 1
            ? "problem + lens"
            : index === 2
              ? "mechanism + outcome"
              : "comparative framing",
      alignment: riskFlags.length > 0 ? "weak" : index === 0 ? "aligned" : "candidate",
      riskFlags,
    };
  });
}

function renderTitleCandidatesMarkdown(params: {
  selectedTitle: string | null;
  candidates: TitleCandidate[];
}): string {
  return [
    "# Title Candidates",
    "",
    `Preferred title: ${params.selectedTitle ?? "unset"}`,
    "",
    ...params.candidates.map(
      (entry, index) =>
        `## ${index + 1}. ${entry.title}\n- focus: ${entry.focus ?? "unset"}\n- alignment: ${entry.alignment}\n- risk_flags: ${entry.riskFlags.join(", ") || "none"}`
    ),
  ].join("\n\n");
}

function renderAbstractWorkbench(params: {
  workflowLine: "experiment" | "survey";
  problem: string | null;
  gap: string | null;
  mechanism: string | null;
  result: string | null;
  implication: string | null;
}): string {
  return [
    "# Abstract 5-Sentence Workbench",
    "",
    `1. Problem\n${sentenceCase(params.problem, "State the real problem and why it matters.")}.`,
    "",
    `2. Gap\n${sentenceCase(params.gap, "State what current work still does not explain or support cleanly.")}.`,
    "",
    `3. Method / Mechanism\n${sentenceCase(params.mechanism, params.workflowLine === "survey" ? "State the survey's organizing lens or synthesis mechanism." : "State the mechanism or system-level move that closes the gap.")}.`,
    "",
    `4. Key Result\n${sentenceCase(params.result, params.workflowLine === "survey" ? "State the most important comparative or structural synthesis result." : "State the strongest evidence-backed result in one sentence.")}.`,
    "",
    `5. Implication / Boundary\n${sentenceCase(params.implication, "State what this changes and keep the boundary explicit.")}.`,
  ].join("\n");
}

function renderIntroWorkbench(params: {
  problem: string | null;
  gap: string | null;
  mechanism: string | null;
  evidenceAnchor: string | null;
  resultArc: string | null;
}): string {
  return [
    "# Intro 5-Paragraph Workbench",
    "",
    "## Paragraph 1: Why This Problem Matters",
    `- Core message: ${sentenceCase(params.problem, "Explain why the problem matters now.")}`,
    "- Reader job: establish stakes, not details.",
    "",
    "## Paragraph 2: Why Current Work Is Insufficient",
    `- Core message: ${sentenceCase(params.gap, "Explain what the strongest current line still misses.")}`,
    "- Reader job: make the gap feel real and reviewable.",
    "",
    "## Paragraph 3: What Unified Lens or Mechanism This Paper Adds",
    `- Core message: ${sentenceCase(params.mechanism, "State the unified mechanism or synthesis lens.")}`,
    "- Reader job: make the paper feel like one thesis, not a feature stack.",
    "",
    "## Paragraph 4: Why The Reader Should Believe It",
    `- Core message: ${sentenceCase(params.evidenceAnchor, "Summarize the evidence arc that makes the thesis credible.")}`,
    "- Reader job: preview the proof path without replaying the Results section.",
    "",
    "## Paragraph 5: What The Reader Should Expect Next",
    `- Core message: ${sentenceCase(params.resultArc, "Preview the section order and the argument order the manuscript will follow.")}`,
    "- Reader job: hand the reader from framing into the paper's actual proof sequence.",
  ].join("\n");
}

export async function materializeTitleAbstractIntroWorkbench(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: TitleAbstractIntroWorkbenchState;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeTitleAbstractIntroWorkbenchState(
    manifest.title_abstract_intro_workbench
  );
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const innovation = normalizeInnovationSynthesisState(
    manifest.innovation_synthesis_state
  );
  const resultsStoryline = normalizeResultsStorylineState(
    manifest.results_storyline
  );
  const reviewPressure = normalizeReviewPressurePacketState(
    manifest.review_pressure_packet
  );
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const workflowLine =
    manifest.workflow_line === "survey" || writingContract.paperMode === "survey"
      ? "survey"
      : "experiment";

  const [
    storySpineText,
    challengeText,
    contributionBridgeText,
    claimMapText,
    fallbackNarrativeText,
    reverseOutlineText,
    limitationAuditText,
    mainTexText,
    resultsQuestionOrderText,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.storySpinePath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.challengeStatementPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStory.contributionToStoryBridgePath)
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.claimToExperimentMapPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.fallbackNarrativePath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, reviewPressure.reverseOutlinePath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, reviewPressure.limitationAuditPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "academic_writer/paper/main.tex")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, resultsStoryline.resultsQuestionOrderPath)),
  ]);

  const problem =
    firstMeaningfulLine(challengeText, storySpineText, reverseOutlineText) ??
    "The manuscript still needs a sharper problem statement.";
  const gap =
    firstMeaningfulLine(reverseOutlineText, fallbackNarrativeText, limitationAuditText) ??
    "Current drafts still leave a reviewer-visible gap between the problem and the proof path.";
  const mechanism =
    innovation.centralThesis ??
    firstMeaningfulLine(contributionBridgeText, claimMapText, storySpineText) ??
    "The manuscript still needs one unified mechanism or synthesis lens.";
  const result =
    firstMeaningfulLine(resultsQuestionOrderText, mainTexText, claimMapText) ??
    "The key result line still needs to be compressed into one evidence-backed sentence.";
  const implication =
    firstMeaningfulLine(limitationAuditText, fallbackNarrativeText) ??
    "The implication and boundary line still needs to be sharpened.";
  const candidates = buildTitleCandidates({
    workflowLine,
    problem,
    mechanism,
    outcome: result,
    implication,
  });
  const selectedTitle =
    candidates.find((entry) => entry.alignment === "aligned")?.title ??
    candidates[0]?.title ??
    null;
  const alignmentStatus =
    selectedTitle &&
    resultsStoryline.status !== "missing" &&
    paperStory.status === "ready"
      ? innovation.status === "ready" || innovation.status === "draft" || innovation.status === "needs_revision"
        ? "aligned"
        : "partial"
      : "missing";
  const status =
    selectedTitle && resultsStoryline.status !== "missing" && paperStory.status === "ready"
      ? "ready"
      : selectedTitle
        ? "draft"
        : "missing";
  const pendingReason =
    status === "ready"
      ? null
      : resultsStoryline.status === "missing"
        ? "results_storyline has not been materialized yet."
        : paperStory.status !== "ready"
          ? "paper_story_state is not ready yet."
          : "Title / abstract / intro alignment still needs stronger story inputs.";
  const workbenchFingerprint = buildFingerprint({
    workflowLine,
    selectedTitle,
    mechanism,
    result,
    alignmentStatus,
  });

  const state = normalizeTitleAbstractIntroWorkbenchState({
    ...serializeTitleAbstractIntroWorkbenchState(current),
    status,
    selected_title: selectedTitle,
    title_candidates: candidates,
    alignment_status: alignmentStatus,
    workbench_fingerprint: workbenchFingerprint,
    pending_reason: pendingReason,
    last_updated_at: nowIso(),
  });

  const titlePath = resolveProjectArtifactPath(projectRoot, state.titleCandidatesPath);
  const abstractPath = resolveProjectArtifactPath(projectRoot, state.abstractWorkbenchPath);
  const introPath = resolveProjectArtifactPath(projectRoot, state.introWorkbenchPath);
  const generatedFiles: string[] = [];
  if (titlePath) {
    await writeTextEnsured(
      titlePath,
      `${renderTitleCandidatesMarkdown({ selectedTitle, candidates })}\n`
    );
    generatedFiles.push(state.titleCandidatesPath ?? "");
  }
  if (abstractPath) {
    await writeTextEnsured(
      abstractPath,
      `${renderAbstractWorkbench({
        workflowLine,
        problem,
        gap,
        mechanism,
        result,
        implication,
      })}\n`
    );
    generatedFiles.push(state.abstractWorkbenchPath ?? "");
  }
  if (introPath) {
    await writeTextEnsured(
      introPath,
      `${renderIntroWorkbench({
        problem,
        gap,
        mechanism,
        evidenceAnchor: firstMeaningfulLine(resultsQuestionOrderText, claimMapText),
        resultArc: firstMeaningfulLine(resultsQuestionOrderText, mainTexText),
      })}\n`
    );
    generatedFiles.push(state.introWorkbenchPath ?? "");
  }

  const nextManifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? manifest;
  nextManifest.title_abstract_intro_workbench =
    serializeTitleAbstractIntroWorkbenchState(state);
  await writeJsonEnsured(manifestPath, nextManifest);

  return {
    state,
    generatedFiles: uniqueStrings(generatedFiles),
  };
}
