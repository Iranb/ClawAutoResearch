import * as path from "node:path";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { serializeStorylinePlannerState } from "../workflow-guard-state/storyline-planner";
import {
  confidenceFromLearnedMargin,
  readLearnedStorylineModel,
  resolveBundledLearnedStorylineModelPath,
  scoreCandidateWithLearnedModel,
  type LearnedStorylineModel,
} from "./survey-storyline-model";
import {
  buildSurveyStorylineCandidates,
  collectSurveyStorylineSignals,
  materializeSurveyStorylinePacket,
  type SurveyStorylinePacket,
  type SurveyStorylineCandidate,
  type SurveyStorylineSelection,
  type SurveyStorylineSignals,
  type SurveyStorylineStrategyId,
} from "./survey-storyline";

export const DEFAULT_SURVEY_STORYLINE_CANDIDATES_PATH =
  "academic_writer/SURVEY_STORYLINE_CANDIDATES.json";
export const DEFAULT_SURVEY_STORYLINE_JUDGE_PACKET_PATH =
  "academic_writer/SURVEY_STORYLINE_JUDGE_PACKET.json";
export const DEFAULT_SURVEY_STORYLINE_SELECTION_PATH =
  "academic_writer/SURVEY_STORYLINE_SELECTION.json";
export const DEFAULT_SURVEY_STORYLINE_SHADOW_SELECTION_PATH =
  "academic_writer/SURVEY_STORYLINE_SHADOW_SELECTION.json";
export const DEFAULT_SURVEY_STORYLINE_REPLAY_DIR =
  "researcher/storyline-replay";
export const DEFAULT_SURVEY_STORYLINE_LEARNED_PRIMARY_EVIDENCE_PATH =
  "academic_writer/SURVEY_STORYLINE_LEARNED_PRIMARY_EVIDENCE.json";

type PlannerMode =
  | "heuristic"
  | "reviewer_judged"
  | "learned_shadow"
  | "learned_primary";

type PlannerCriterionId =
  | "thesis_sharpness"
  | "field_specificity"
  | "evidence_alignment"
  | "benchmark_honesty"
  | "contradiction_coverage"
  | "section_order_coherence"
  | "reviewer_memorability";

type CandidateFeatureVector = Record<string, number>;

type CandidateCriterionScore = {
  criterionId: PlannerCriterionId;
  score: number;
  justification: string;
};

type CandidateJudgeVerdict = {
  strategyId: SurveyStorylineStrategyId;
  label: string;
  rubric: CandidateCriterionScore[];
  totalScore: number;
  criticalRisks: string[];
  strengths: string[];
  confidence: number;
};

type PairwiseJudgeVerdict = {
  leftStrategyId: SurveyStorylineStrategyId;
  rightStrategyId: SurveyStorylineStrategyId;
  winnerStrategyId: SurveyStorylineStrategyId;
  margin: number;
  reason: string;
};

export type SurveyStorylineSelectionArtifact = {
  schemaVersion: number;
  mode: PlannerMode;
  topic: string;
  selectedStrategyId: SurveyStorylineStrategyId;
  selectedStrategyLabel: string;
  selectedStrategyRationale: string[];
  selectionConfidence: number | null;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  selectionFingerprint: string;
  comparedStrategyIds: SurveyStorylineStrategyId[];
  generatedAt: string;
};

type SurveyStorylineJudgePacket = {
  schemaVersion: number;
  mode: "reviewer_judged";
  topic: string;
  criteria: Array<{
    criterionId: PlannerCriterionId;
    label: string;
    weight: number;
  }>;
  candidateVerdicts: CandidateJudgeVerdict[];
  pairwiseMatrix: PairwiseJudgeVerdict[];
  winnerStrategyId: SurveyStorylineStrategyId;
  winnerConfidence: number;
  generatedAt: string;
};

type SurveyStorylineCandidatesArtifact = {
  schemaVersion: number;
  topic: string;
  candidates: Array<
    SurveyStorylineCandidate & {
      featureVector: CandidateFeatureVector;
    }
  >;
  generatedAt: string;
};

type SurveyStorylinePlannerStateLike = {
  status: string;
  configuredMode: PlannerMode;
  activePrimaryMode: PlannerMode;
  fallbackToHeuristic: boolean;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  shadowMode: PlannerMode | null;
  shadowDiffStatus: string | null;
  selectionConfidence: number | null;
  candidatePath: string | null;
  judgePacketPath: string | null;
  selectionPath: string | null;
  shadowSelectionPath: string | null;
  learnedPrimaryEvidencePath: string | null;
  learnedModelId: string | null;
  learnedModelPath: string | null;
  lastUpdatedAt: string | null;
  selectionFingerprint: string | null;
  pendingReason: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function scoreNormalized(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(5, (value / maxValue) * 5));
}

export function buildSurveyStorylineFeatureVector(
  signals: SurveyStorylineSignals,
  candidate: SurveyStorylineCandidate
): CandidateFeatureVector {
  const strategy = candidate.strategyId;
  const order = candidate.bodySectionOrder;
  const defaultOrder = [
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
  ];
  const orderNovelty = order.reduce((count, sectionId, index) => {
    return count + (defaultOrder[index] !== sectionId ? 1 : 0);
  }, 0);
  const explicitBenchmarkTension = [
    ...signals.benchmarkPressureLines,
    ...signals.gapLines,
    ...signals.contradictionLines,
    signals.reviewProtocolText ?? "",
  ].filter((line) =>
    /\bfair\b|\bcompar|\bnon[-\s]?comparable|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b|\bprotocol/i.test(
      line
    )
  ).length;
  const benchmarkPressure = Math.min(
    10,
    explicitBenchmarkTension * 2 + Math.min(2, signals.gapLines.length)
  );
  const contradictionPressure = Math.min(
    10,
    signals.contradictionLines.length + signals.backgroundLines.length + signals.gapLines.length
  );
  const familySignal = Math.min(10, signals.familyLines.length * 2);
  const historicalPressure = /histor|evolution|generation|transition/i.test(
    [signals.topic, ...signals.familyLines, ...signals.coverageLines].join("\n")
  )
    ? 6
    : 0;
  const applicationPressure = /application|setting|scenario|task|open world|zero-shot/i.test(
    [signals.topic, ...signals.backgroundLines, ...signals.coverageLines].join("\n")
  )
    ? 6
    : 0;
  const intellectualCenterBenchmark =
    candidate.intellectualCenterSection === "benchmark_landscape" ? 1 : 0;
  const intellectualCenterTaxonomy =
    candidate.intellectualCenterSection === "taxonomy" ? 1 : 0;
  const intellectualCenterEvidence =
    candidate.intellectualCenterSection === "evidence_synthesis" ? 1 : 0;
  return {
    heuristic_score: candidate.score,
    benchmark_pressure: strategy === "evaluation_crisis_first" ? benchmarkPressure : 0,
    contradiction_pressure: strategy === "contradiction_first" ? contradictionPressure : 0,
    family_signal: strategy === "taxonomy_first" ? familySignal : familySignal * 0.4,
    historical_pressure: strategy === "historical_evolution_first" ? historicalPressure : 0,
    application_pressure: strategy === "application_split_first" ? applicationPressure : 0,
    order_novelty: orderNovelty,
    intellectual_center_benchmark: intellectualCenterBenchmark,
    intellectual_center_taxonomy: intellectualCenterTaxonomy,
    intellectual_center_evidence: intellectualCenterEvidence,
  };
}

const REVIEW_CRITERIA: Array<{
  criterionId: PlannerCriterionId;
  label: string;
  weight: number;
}> = [
  { criterionId: "thesis_sharpness", label: "Thesis sharpness", weight: 1.4 },
  { criterionId: "field_specificity", label: "Field specificity", weight: 1.1 },
  { criterionId: "evidence_alignment", label: "Evidence alignment", weight: 1.2 },
  { criterionId: "benchmark_honesty", label: "Benchmark honesty", weight: 1.2 },
  { criterionId: "contradiction_coverage", label: "Contradiction coverage", weight: 1.0 },
  { criterionId: "section_order_coherence", label: "Section-order coherence", weight: 1.0 },
  { criterionId: "reviewer_memorability", label: "Reviewer memorability", weight: 1.1 },
];

function computeCriterionScore(params: {
  signals: SurveyStorylineSignals;
  candidate: SurveyStorylineCandidate;
  features: CandidateFeatureVector;
  criterionId: PlannerCriterionId;
}): CandidateCriterionScore {
  const { signals, candidate, features, criterionId } = params;
  const explicitBenchmarkPressure = signals.benchmarkPressureLines.length;
  const hasStrongThesis =
    candidate.thesis.split(/\s+/).length >= 12 &&
    /field|benchmark|family|survey|comparison|evidence/i.test(candidate.thesis);
  switch (criterionId) {
    case "thesis_sharpness":
      return {
        criterionId,
        score: hasStrongThesis ? 4.5 : 3.0,
        justification: hasStrongThesis
          ? `The thesis is explicit and ties the field story to one organizing pressure: ${candidate.thesis}`
          : "The thesis is present but still too generic to anchor the full survey.",
      };
    case "field_specificity":
      return {
        criterionId,
        score: scoreNormalized(
          signals.familyLines.length +
            signals.benchmarkLines.length +
            signals.backgroundLines.length,
          12
        ),
        justification:
          signals.familyLines.length > 0 || signals.benchmarkLines.length > 0
            ? "The candidate is grounded in concrete family / benchmark language from the active survey packet."
            : "The candidate still reads too much like a generic survey template.",
      };
    case "evidence_alignment":
      return {
        criterionId,
        score: scoreNormalized(features.heuristic_score + signals.includedLabels.length, 16),
        justification:
          signals.includedLabels.length > 0
            ? "Representative included papers and packet anchors are available to support the selected story."
            : "The survey packet does not yet expose enough concrete exemplars to make the story feel anchored.",
      };
    case "benchmark_honesty":
      return {
        criterionId,
        score:
          candidate.strategyId === "evaluation_crisis_first"
            ? explicitBenchmarkPressure > 0
              ? scoreNormalized(features.benchmark_pressure + 4, 14)
              : 2.0
            : scoreNormalized(features.benchmark_pressure + (signals.familyLines.length > 2 ? 1 : 0), 14),
        justification:
          candidate.strategyId === "evaluation_crisis_first"
            ? explicitBenchmarkPressure > 0
              ? "The candidate turns benchmark comparability into a first-class organizing rule."
              : "Benchmark tables exist, but the packet does not show enough explicit fairness pressure to justify a benchmark-led opening."
            : "The candidate acknowledges benchmark issues without letting them overrun the whole field story.",
      };
    case "contradiction_coverage":
      return {
        criterionId,
        score:
          candidate.strategyId === "contradiction_first"
            ? scoreNormalized(features.contradiction_pressure + 4, 14)
            : scoreNormalized(features.contradiction_pressure, 14),
        justification:
          signals.contradictionLines.length > 0
            ? "The survey packet already contains contradiction / non-comparable signals that this candidate can expose."
            : "Contradiction pressure is currently thin, so over-indexing on disagreement would be weak.",
      };
    case "section_order_coherence":
      return {
        criterionId,
        score:
          candidate.bodySectionOrder.length === 5
            ? candidate.strategyId === "evaluation_crisis_first" &&
              explicitBenchmarkPressure === 0
              ? 2.6
              : 4.0
            : 3.0,
        justification:
          candidate.bodySectionOrder[0] === "scope_and_protocol"
            ? explicitBenchmarkPressure === 0 &&
              candidate.strategyId === "evaluation_crisis_first"
              ? "The order is structurally coherent, but it promotes benchmark pressure earlier than the packet currently supports."
              : "The section order still opens with scope discipline before larger synthesis claims."
            : "The section order risks widening claims before the survey boundary contract is clear.",
      };
    case "reviewer_memorability":
      return {
        criterionId,
        score:
          candidate.intellectualCenterSection === "benchmark_landscape"
            ? explicitBenchmarkPressure > 0
              ? 4.4
              : 3.4
            : candidate.intellectualCenterSection === "taxonomy" &&
                signals.familyLines.length >= 3
              ? 4.3
              : candidate.intellectualCenterSection === "evidence_synthesis"
                ? 4.1
                : 3.8,
        justification: `The candidate gives the manuscript one clear intellectual center: ${candidate.intellectualCenterSection}.`,
      };
  }
}

function buildReviewerJudgment(params: {
  signals: SurveyStorylineSignals;
  candidates: SurveyStorylineCandidate[];
}): SurveyStorylineJudgePacket {
  const candidateVerdicts: CandidateJudgeVerdict[] = params.candidates.map((candidate) => {
    const features = buildSurveyStorylineFeatureVector(params.signals, candidate);
    const rubric = REVIEW_CRITERIA.map((criterion) =>
      computeCriterionScore({
        signals: params.signals,
        candidate,
        features,
        criterionId: criterion.criterionId,
      })
    );
    const totalScore = Number(
      rubric
        .reduce((sum, entry) => {
          const criterion = REVIEW_CRITERIA.find(
            (item) => item.criterionId === entry.criterionId
          );
          return sum + entry.score * (criterion?.weight ?? 1);
        }, 0)
        .toFixed(4)
    );
    const criticalRisks = uniqueStrings([
      candidate.strategyId === "taxonomy_first" &&
      params.signals.benchmarkLines.length >= 4
        ? "Benchmark pressure may be too strong for a taxonomy-first opening."
        : null,
      candidate.strategyId === "evaluation_crisis_first" &&
      params.signals.benchmarkLines.length < 2
        ? "Benchmark-led ordering may outrun the actual benchmark evidence."
        : null,
      candidate.strategyId === "contradiction_first" &&
      params.signals.contradictionLines.length < 2
        ? "Contradiction-first ordering may be theatrically strong but under-supported."
        : null,
    ]);
    const strengths = uniqueStrings([
      candidate.rationale[0] ?? null,
      candidate.intellectualCenterSection
        ? `Intellectual center is explicit: ${candidate.intellectualCenterSection}.`
        : null,
    ]);
    const confidence = Number(
      Math.max(0, Math.min(1, totalScore / (5 * REVIEW_CRITERIA.length))).toFixed(4)
    );
    return {
      strategyId: candidate.strategyId,
      label: candidate.label,
      rubric,
      totalScore,
      criticalRisks,
      strengths,
      confidence,
    };
  });
  const sorted = [...candidateVerdicts].sort(
    (left, right) => right.totalScore - left.totalScore
  );
  const winner = sorted[0] ?? null;
  const runnerUp = sorted[1] ?? null;
  const pairwiseMatrix: PairwiseJudgeVerdict[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      const margin = Number(Math.abs(left.totalScore - right.totalScore).toFixed(4));
      const better = left.totalScore >= right.totalScore ? left : right;
      const weaker = better === left ? right : left;
      pairwiseMatrix.push({
        leftStrategyId: left.strategyId,
        rightStrategyId: right.strategyId,
        winnerStrategyId: better.strategyId,
        margin,
        reason:
          margin > 0.75
            ? `${better.label} is materially sharper than ${weaker.label} on the reviewer rubric.`
            : `${better.label} only narrowly beats ${weaker.label}; keep confidence conservative.`,
      });
    }
  }
  const winnerConfidence = Number(
    Math.max(
      0,
      Math.min(
        1,
        ((winner?.totalScore ?? 0) - (runnerUp?.totalScore ?? 0)) /
          Math.max(1, winner?.totalScore ?? 1)
      )
    ).toFixed(4)
  );
  return {
    schemaVersion: 1,
    mode: "reviewer_judged",
    topic: params.signals.topic,
    criteria: REVIEW_CRITERIA,
    candidateVerdicts,
    pairwiseMatrix,
    winnerStrategyId: winner?.strategyId ?? "taxonomy_first",
    winnerConfidence,
    generatedAt: nowIso(),
  };
}

function buildLearnedSelection(params: {
  model: LearnedStorylineModel;
  signals: SurveyStorylineSignals;
  candidates: SurveyStorylineCandidate[];
  mode: "learned_shadow" | "learned_primary";
}): SurveyStorylineSelectionArtifact {
  const scored = params.candidates.map((candidate) => {
    const features = buildSurveyStorylineFeatureVector(params.signals, candidate);
    const total = scoreCandidateWithLearnedModel({
      model: params.model,
      featureVector: features,
    });
    return {
      candidate,
      total,
      features,
    };
  });
  scored.sort((left, right) => right.total - left.total);
  const winner = scored[0]?.candidate ?? params.candidates[0];
  const runnerUp = scored[1]?.candidate ?? null;
  const margin =
    scored.length >= 2 ? Math.abs((scored[0]?.total ?? 0) - (scored[1]?.total ?? 0)) : 0;
  return {
    schemaVersion: 1,
    mode: params.mode,
    topic: params.signals.topic,
    selectedStrategyId: winner?.strategyId ?? "taxonomy_first",
    selectedStrategyLabel: winner?.label ?? "Taxonomy-first",
    selectedStrategyRationale: uniqueStrings([
      winner?.rationale[0] ?? null,
      `${params.mode === "learned_primary" ? "Primary" : "Shadow"} reranker score margin: ${margin.toFixed(4)}.`,
      runnerUp
        ? `Runner-up candidate: ${runnerUp.label}.`
        : "No runner-up candidate was available.",
    ]),
    selectionConfidence: confidenceFromLearnedMargin({
      margin,
      threshold: params.model.confidenceMarginThreshold,
    }),
    fallbackTriggered: false,
    fallbackReason: null,
    selectionFingerprint: `${params.signals.topic}:${winner?.strategyId ?? "taxonomy_first"}:${params.mode}:${params.model.modelId}`,
    comparedStrategyIds: params.candidates.map((entry) => entry.strategyId),
    generatedAt: nowIso(),
  };
}

function buildPrimarySelectionFromJudge(params: {
  judgePacket: SurveyStorylineJudgePacket;
  candidates: SurveyStorylineCandidate[];
}): SurveyStorylineSelectionArtifact {
  const winner =
    params.candidates.find(
      (candidate) => candidate.strategyId === params.judgePacket.winnerStrategyId
    ) ?? params.candidates[0];
  return {
    schemaVersion: 1,
    mode: "reviewer_judged",
    topic: params.judgePacket.topic,
    selectedStrategyId: winner?.strategyId ?? "taxonomy_first",
    selectedStrategyLabel: winner?.label ?? "Taxonomy-first",
    selectedStrategyRationale: uniqueStrings([
      ...winner?.rationale ?? [],
      ...params.judgePacket.candidateVerdicts
        .find((entry) => entry.strategyId === winner?.strategyId)
        ?.strengths ?? [],
    ]),
    selectionConfidence: params.judgePacket.winnerConfidence,
    fallbackTriggered: false,
    fallbackReason: null,
    selectionFingerprint: `${params.judgePacket.topic}:${winner?.strategyId ?? "taxonomy_first"}:reviewer_judged`,
    comparedStrategyIds: params.candidates.map((entry) => entry.strategyId),
    generatedAt: nowIso(),
  };
}

function serializeCandidatesArtifact(
  topic: string,
  signals: SurveyStorylineSignals,
  candidates: SurveyStorylineCandidate[]
): SurveyStorylineCandidatesArtifact {
  return {
    schemaVersion: 1,
    topic,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      featureVector: buildSurveyStorylineFeatureVector(signals, candidate),
    })),
    generatedAt: nowIso(),
  };
}

export async function materializeSurveyStorylinePlanner(params: {
  projectRoot: string;
  topic: string | null;
  configuredMode?: PlannerMode | null;
  learnedModelPath?: string | null;
  candidatePath?: string | null;
  judgePacketPath?: string | null;
  selectionPath?: string | null;
  shadowSelectionPath?: string | null;
  learnedPrimaryEvidencePath?: string | null;
  packetPath?: string | null;
  memoPath?: string | null;
}): Promise<{
  state: SurveyStorylinePlannerStateLike;
  candidatesArtifact: SurveyStorylineCandidatesArtifact;
  judgePacket: SurveyStorylineJudgePacket;
  selection: SurveyStorylineSelectionArtifact;
  shadowSelection: SurveyStorylineSelectionArtifact;
  packet: SurveyStorylinePacket;
  learnedPrimaryEvidence: Record<string, unknown>;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const candidatePath = params.candidatePath ?? DEFAULT_SURVEY_STORYLINE_CANDIDATES_PATH;
  const judgePacketPath = params.judgePacketPath ?? DEFAULT_SURVEY_STORYLINE_JUDGE_PACKET_PATH;
  const selectionPath = params.selectionPath ?? DEFAULT_SURVEY_STORYLINE_SELECTION_PATH;
  const shadowSelectionPath =
    params.shadowSelectionPath ?? DEFAULT_SURVEY_STORYLINE_SHADOW_SELECTION_PATH;
  const learnedPrimaryEvidencePath =
    params.learnedPrimaryEvidencePath ??
    DEFAULT_SURVEY_STORYLINE_LEARNED_PRIMARY_EVIDENCE_PATH;
  const configuredMode = params.configuredMode ?? "reviewer_judged";
  const effectiveLearnedModelPath =
    params.learnedModelPath ?? resolveBundledLearnedStorylineModelPath();
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const paperStoryState = normalizePaperStoryState(manifest.paper_story_state);

  const signals = await collectSurveyStorylineSignals({
    projectRoot,
    topic: params.topic,
  });
  const candidates = buildSurveyStorylineCandidates({
    topic: signals.topic,
    familyLines: signals.familyLines,
    benchmarkLines: signals.benchmarkLines,
    benchmarkPressureLines: signals.benchmarkPressureLines,
    gapLines: signals.gapLines,
    contradictionLines: signals.contradictionLines,
    coverageLines: signals.coverageLines,
    backgroundLines: signals.backgroundLines,
    litReviewText: signals.literatureReviewText,
    surveyBriefText: signals.surveyBriefText,
    reviewProtocolText: signals.reviewProtocolText,
  });
  const candidatesArtifact = serializeCandidatesArtifact(
    signals.topic,
    signals,
    candidates
  );
  const judgePacket = buildReviewerJudgment({
    signals,
    candidates,
  });
  let selection = buildPrimarySelectionFromJudge({
    judgePacket,
    candidates,
  });
  const learnedModel = await readLearnedStorylineModel(effectiveLearnedModelPath);
  const learnedPrimarySelection =
    learnedModel
      ? buildLearnedSelection({
          model: learnedModel,
          signals,
          candidates,
          mode: "learned_primary",
        })
      : null;
  if (configuredMode === "heuristic") {
    selection = {
      ...selection,
      mode: "heuristic",
      selectedStrategyId: candidates[0]?.strategyId ?? selection.selectedStrategyId,
      selectedStrategyLabel: candidates[0]?.label ?? selection.selectedStrategyLabel,
      selectedStrategyRationale:
        candidates[0]?.rationale.length ? candidates[0].rationale : selection.selectedStrategyRationale,
      selectionConfidence: null,
      fallbackTriggered: true,
      fallbackReason: "Configured mode prefers the heuristic primary path.",
      selectionFingerprint: `${signals.topic}:${candidates[0]?.strategyId ?? selection.selectedStrategyId}:heuristic`,
    };
  } else if (configuredMode === "learned_primary") {
    if (!learnedPrimarySelection) {
      selection = {
        ...selection,
        fallbackTriggered: true,
        fallbackReason:
          "learned primary requested but no trained model artifact is available; falling back to reviewer_judged.",
      };
    } else if ((learnedPrimarySelection.selectionConfidence ?? 0) < 0.5) {
      selection = {
        ...selection,
        fallbackTriggered: true,
        fallbackReason:
          `learned primary confidence ${(learnedPrimarySelection.selectionConfidence ?? 0).toFixed(4)} is below the stable threshold 0.5; falling back to reviewer_judged.`,
      };
    } else {
      selection = learnedPrimarySelection;
    }
  }
  const shadowSelection = learnedModel
    ? buildLearnedSelection({
        model: learnedModel,
        signals,
        candidates,
        mode: "learned_shadow",
      })
    : {
        schemaVersion: 1,
        mode: "learned_shadow" as const,
        topic: signals.topic,
        selectedStrategyId: selection.selectedStrategyId,
        selectedStrategyLabel: selection.selectedStrategyLabel,
        selectedStrategyRationale: [
          "No trained learned model artifact is available, so shadow mode mirrors the primary selection.",
        ],
        selectionConfidence: 0,
        fallbackTriggered: true,
        fallbackReason: "No trained learned model artifact is available.",
        selectionFingerprint: `${signals.topic}:${selection.selectedStrategyId}:learned_shadow:missing_model`,
        comparedStrategyIds: candidates.map((entry) => entry.strategyId),
        generatedAt: nowIso(),
      };
  const shadowDiffStatus =
    shadowSelection.selectedStrategyId === selection.selectedStrategyId
      ? "match"
      : "diverged";
  const learnedPrimaryEvidence = {
    schema_version: 1,
    configured_mode: configuredMode,
    learned_model_id: learnedModel?.modelId ?? null,
    learned_model_path: effectiveLearnedModelPath,
    learned_primary_candidate:
      learnedPrimarySelection == null
        ? null
        : {
            selected_strategy_id: learnedPrimarySelection.selectedStrategyId,
            selection_confidence: learnedPrimarySelection.selectionConfidence,
            selection_fingerprint: learnedPrimarySelection.selectionFingerprint,
          },
    primary_selection_mode: selection.mode,
    primary_fallback_triggered: selection.fallbackTriggered,
    primary_fallback_reason: selection.fallbackReason,
    generated_at: nowIso(),
  };
  const packetSelection: SurveyStorylineSelection = {
    selectedStrategyId: selection.selectedStrategyId,
    selectedStrategyRationale: selection.selectedStrategyRationale,
    selectionMode: selection.mode,
    selectionConfidence: selection.selectionConfidence,
    fallbackTriggered: selection.fallbackTriggered,
    fallbackReason: selection.fallbackReason,
  };
  const packetResult = await materializeSurveyStorylinePacket({
    projectRoot,
    topic: signals.topic,
    packetPath: params.packetPath ?? paperStoryState.surveyStorylinePacketPath,
    memoPath: params.memoPath ?? paperStoryState.surveyStorylineMemoPath,
    selection: packetSelection,
    candidates,
    signals,
  });

  const resolvedCandidatePath = resolveProjectArtifactPath(projectRoot, candidatePath);
  const resolvedJudgePacketPath = resolveProjectArtifactPath(projectRoot, judgePacketPath);
  const resolvedSelectionPath = resolveProjectArtifactPath(projectRoot, selectionPath);
  const resolvedShadowSelectionPath = resolveProjectArtifactPath(projectRoot, shadowSelectionPath);
  const resolvedLearnedPrimaryEvidencePath = resolveProjectArtifactPath(
    projectRoot,
    learnedPrimaryEvidencePath
  );
  if (
    !resolvedCandidatePath ||
    !resolvedJudgePacketPath ||
    !resolvedSelectionPath ||
    !resolvedShadowSelectionPath ||
    !resolvedLearnedPrimaryEvidencePath
  ) {
    throw new Error("Unable to resolve survey storyline planner paths.");
  }
  await writeJsonEnsured(resolvedCandidatePath, {
    schema_version: candidatesArtifact.schemaVersion,
    topic: candidatesArtifact.topic,
    candidates: candidatesArtifact.candidates.map((entry) => ({
      strategy_id: entry.strategyId,
      label: entry.label,
      score: entry.score,
      rationale: entry.rationale,
      body_section_order: entry.bodySectionOrder,
      intellectual_center_section: entry.intellectualCenterSection,
      thesis: entry.thesis,
      opening_move: entry.openingMove,
      feature_vector: entry.featureVector,
    })),
    generated_at: candidatesArtifact.generatedAt,
  });
  await writeJsonEnsured(resolvedJudgePacketPath, {
    schema_version: judgePacket.schemaVersion,
    mode: judgePacket.mode,
    topic: judgePacket.topic,
    criteria: judgePacket.criteria.map((entry) => ({
      criterion_id: entry.criterionId,
      label: entry.label,
      weight: entry.weight,
    })),
    candidate_verdicts: judgePacket.candidateVerdicts.map((entry) => ({
      strategy_id: entry.strategyId,
      label: entry.label,
      rubric: entry.rubric.map((criterion) => ({
        criterion_id: criterion.criterionId,
        score: criterion.score,
        justification: criterion.justification,
      })),
      total_score: entry.totalScore,
      critical_risks: entry.criticalRisks,
      strengths: entry.strengths,
      confidence: entry.confidence,
    })),
    pairwise_matrix: judgePacket.pairwiseMatrix.map((entry) => ({
      left_strategy_id: entry.leftStrategyId,
      right_strategy_id: entry.rightStrategyId,
      winner_strategy_id: entry.winnerStrategyId,
      margin: entry.margin,
      reason: entry.reason,
    })),
    winner_strategy_id: judgePacket.winnerStrategyId,
    winner_confidence: judgePacket.winnerConfidence,
    generated_at: judgePacket.generatedAt,
  });
  await writeJsonEnsured(resolvedSelectionPath, {
    schema_version: selection.schemaVersion,
    mode: selection.mode,
    topic: selection.topic,
    selected_strategy_id: selection.selectedStrategyId,
    selected_strategy_label: selection.selectedStrategyLabel,
    selected_strategy_rationale: selection.selectedStrategyRationale,
    selection_confidence: selection.selectionConfidence,
    fallback_triggered: selection.fallbackTriggered,
    fallback_reason: selection.fallbackReason,
    selection_fingerprint: selection.selectionFingerprint,
    compared_strategy_ids: selection.comparedStrategyIds,
    generated_at: selection.generatedAt,
  });
  await writeJsonEnsured(resolvedShadowSelectionPath, {
    schema_version: shadowSelection.schemaVersion,
    mode: shadowSelection.mode,
    topic: shadowSelection.topic,
    selected_strategy_id: shadowSelection.selectedStrategyId,
    selected_strategy_label: shadowSelection.selectedStrategyLabel,
    selected_strategy_rationale: shadowSelection.selectedStrategyRationale,
    selection_confidence: shadowSelection.selectionConfidence,
    fallback_triggered: shadowSelection.fallbackTriggered,
    fallback_reason: shadowSelection.fallbackReason,
    selection_fingerprint: shadowSelection.selectionFingerprint,
    compared_strategy_ids: shadowSelection.comparedStrategyIds,
    generated_at: shadowSelection.generatedAt,
  });
  await writeJsonEnsured(
    resolvedLearnedPrimaryEvidencePath,
    learnedPrimaryEvidence
  );

  const state: SurveyStorylinePlannerStateLike = {
    status: "ready",
    configuredMode,
    activePrimaryMode: selection.mode,
    fallbackToHeuristic: true,
    fallbackTriggered: selection.fallbackTriggered,
    fallbackReason: selection.fallbackReason,
    shadowMode: "learned_shadow",
    shadowDiffStatus,
    selectionConfidence: selection.selectionConfidence,
    candidatePath,
    judgePacketPath,
    selectionPath,
    shadowSelectionPath,
    learnedPrimaryEvidencePath,
    learnedModelId: learnedModel?.modelId ?? null,
    learnedModelPath: effectiveLearnedModelPath,
    lastUpdatedAt: nowIso(),
    selectionFingerprint: selection.selectionFingerprint,
    pendingReason: null,
  };

  const generatedFiles = uniqueStrings([
    candidatePath,
    judgePacketPath,
    selectionPath,
    shadowSelectionPath,
    learnedPrimaryEvidencePath,
    ...packetResult.generatedFiles,
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  manifest.storyline_planner = serializeStorylinePlannerState(state);
  await writeJsonEnsured(manifestPath, manifest);

  return {
    state,
    candidatesArtifact,
    judgePacket,
    selection,
    shadowSelection,
    packet: packetResult.packet,
    learnedPrimaryEvidence,
    generatedFiles,
  };
}
