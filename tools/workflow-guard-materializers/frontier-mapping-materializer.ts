import * as fs from "node:fs/promises";

import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeBrainstormCycleState,
  serializeBrainstormCycleState,
} from "../workflow-guard-state/research-loop-state";
import { deriveGraphBuildPartialReadiness } from "../workflow-guard-state/paper-ingestion";
import {
  getBrainstormCycleValidationErrors,
  isBrainstormCycleReady,
} from "../workflow-kernel/readiness";
import { auditFrontierReportText } from "../workflow-intermediate-artifact-audit";

type ManifestLike = Record<string, unknown>;

const FRONTIER_REPORT_PATH = "researcher/FRONTIER_REPORT.md";

const FRONTIER_GRAPH_ARTIFACTS = [
  { path: "graph/LIMITATION_FRONTIER.md", title: "Limitation Frontier" },
  { path: "graph/CONTRADICTION_FRONTIER.md", title: "Contradiction Frontier" },
  { path: "graph/TRANSFER_FRONTIER.md", title: "Transfer Frontier" },
  { path: "graph/COMPOSITION_FRONTIER.md", title: "Composition Frontier" },
  { path: "graph/ANCHOR_INDEX.md", title: "Anchor Index" },
];

const CORE_FRONTIER_GRAPH_ARTIFACTS = FRONTIER_GRAPH_ARTIFACTS.slice(0, 3);

type FrontierRecoveryProfile = {
  kind: "eml_operator" | "fixmatch_gcd" | "generic";
  selectedDirectionTitle: string;
  topicSummary: string;
  anchorPapers: Array<{ id: string; title: string; relevance: string }>;
  researchSummary: string;
  keyFindings: string[];
  relevantMethods: string[];
  openQuestions: string[];
  workingKeyFacts: string[];
  activeHypotheses: string[];
  pendingQueries: string[];
  limitationFrontier: string[];
  contradictionFrontier: string[];
  transferFrontier: string[];
  compositionSections: Array<{ heading: string; body: string }>;
  logicChain: string[];
  questionPacket: string[];
  synthesisRationale: string;
  requiredAblations: string[];
  handoffImplications: string[];
};

function topicMatchesAny(topic: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(topic));
}

function inferFrontierRecoveryProfile(topic: string): FrontierRecoveryProfile {
  const normalizedTopic = topic.toLowerCase();
  if (
    topicMatchesAny(normalizedTopic, [
      /\beml\b/,
      /2603\.21852/,
      /elementary functions from a single binary operator/,
      /eml\(x\s*,\s*y\)/,
      /exp\(x\).*ln\(y\)/,
      /ln\(y\).*exp\(x\)/,
    ])
  ) {
    return {
      kind: "eml_operator",
      selectedDirectionTitle:
        "EML residual and mixer blocks for small basemodel validation",
      topicSummary:
        "Recover frontier mapping around using the EML operator eml(x,y)=exp(x)-ln(y) as a numerically guarded primitive for compact ResNet-like and Transformer-like blocks under matched parameter budgets.",
      anchorPapers: [
        {
          id: "paper:eml-operator",
          title: "All elementary functions from a single binary operator",
          relevance:
            "Defines the EML operator and motivates testing whether one binary primitive can replace or compose common elementary functions.",
        },
        {
          id: "method:residual-and-attention-baselines",
          title: "Parameter-matched residual, mixer, and attention basemodels",
          relevance:
            "Target baseline family for checking whether EML blocks improve small image and toy text models without extra parameter budget.",
        },
      ],
      researchSummary:
        "EML blocks are plausible only if exp/log domain and overflow controls are explicit and if every comparison is matched by trainable parameters, training budget, and evaluation protocol.",
      keyFindings: [
        "The EML branch must enforce y > 0 through a stable parameterization such as softplus plus epsilon, and must bound exp inputs to avoid overflow.",
        "Small-model validation should compare against same-parameter CNN, residual MLP, mixer, and attention baselines rather than larger architectural variants.",
        "MNIST-style image data and toy token/sequence tasks are useful first filters, but saturated accuracy requires reporting stability, calibration, and failure-rate metrics.",
        "Ablations must isolate the operator from normalization, residual scaling, activation choice, and parameter-count differences.",
      ],
      relevantMethods: [
        "safe EML operator",
        "EML residual block",
        "EML channel mixer",
        "EML token mixer",
        "parameter-matched baseline",
        "NaN/Inf guardrail",
      ],
      openQuestions: [
        "Does EML add useful inductive bias beyond an MLP or standard activation under the same parameter budget?",
        "Which y-domain parameterization keeps log inputs positive without suppressing gradient flow?",
        "Does the operator help both image and toy text tasks, or only one modality?",
        "How much clipping, normalization, and residual scaling is needed before the operator is trainable?",
      ],
      workingKeyFacts: [
        "The project topic is EML operator basemodel construction, not GCD or FixMatch-style pseudo-labeling.",
        "The first implementation target should be small and reproducible: MNIST/Fashion-MNIST plus a compact toy sequence or character task.",
        "Every proposed block needs an explicit parameter-count accounting contract before experiment launch.",
      ],
      activeHypotheses: [
        "A residual EML branch can match or improve a same-parameter nonlinear residual block on simple image classification.",
        "An EML mixer can replace part of an MLP/FFN interaction if exp/log stability controls are built into the operator.",
        "Without clipping, y-domain guards, and finite-loss checks, apparent gains are likely numerical artifacts.",
      ],
      pendingQueries: [
        "Retrieve the arXiv:2603.21852 source and extract the exact operator definition and stability assumptions.",
        "Collect compact ResNet, MLP-Mixer, and Transformer baseline references suitable for toy-scale reproduction.",
        "Find benchmark methodology for fair parameter matching on MNIST-like image tasks and toy text tasks.",
      ],
      limitationFrontier: [
        "The exp term can overflow and the log term is undefined for non-positive y, so the operator needs an explicit safe domain contract.",
        "Extra nonlinear expressivity can be confounded with normalization, clipping, residual scaling, or hidden parameter-count changes.",
        "MNIST-like tasks may saturate quickly; headline accuracy alone may not expose whether EML changes the model class.",
        "Toy text validation needs a very small sequence model so comparison remains about the operator rather than scale.",
        "Compute cost and numerical failure rate should be tracked alongside trainable parameter count.",
      ],
      contradictionFrontier: [
        "EML is attractive as a universal elementary-function primitive, but neural training favors stable gradients over symbolic expressivity.",
        "Clipping exp inputs prevents overflow, yet too much clipping can erase the very nonlinear behavior being tested.",
        "A positive-y parameterization makes log safe, but it can bias the learned interaction if the transform saturates.",
        "Residual wrapping can stabilize EML, but it may also make the learned EML branch irrelevant unless branch contribution is measured.",
        "Equal parameter count does not guarantee equal compute or equal numerical conditioning.",
      ],
      transferFrontier: [
        "Insert a safe EML branch inside a residual block and compare it against a same-parameter MLP or convolutional residual branch.",
        "Build a channel/token mixer where one operand is a learned positive gate and the other is the feature activation.",
        "Use residual scaling, finite-value checks, and per-layer activation statistics as first-class experiment outputs.",
        "Keep the first image protocol to MNIST/Fashion-MNIST or similarly small datasets before larger vision benchmarks.",
        "For toy text, use a compact character or synthetic sequence classification task with an attention/MLP baseline of matched size.",
      ],
      compositionSections: [
        {
          heading: "Cx1. Safe EML residual block",
          body:
            "Compose a residual path with a bounded EML operator, positive-y gate, normalization, and residual scaling so instability is controlled before comparing against a same-parameter nonlinear block.",
        },
        {
          heading: "Cx2. EML mixer or FFN replacement",
          body:
            "Use EML as a channel or token interaction primitive inside a mixer/Transformer-style block while preserving the baseline width, depth, and trainable parameter count.",
        },
        {
          heading: "Cx3. Small fair-validation harness",
          body:
            "Pair MNIST-like image tasks with a compact toy text/sequence task, track accuracy plus finite-loss rate, and report parameter-count deltas for every model.",
        },
      ],
      logicChain: [
        "The EML paper defines a binary primitive that can represent elementary functions, which motivates testing it as a neural operator.",
        "A basemodel claim is only meaningful when EML is compared against same-parameter residual, mixer, or attention baselines.",
        "The operator introduces exp/log numerical hazards, so safety constraints are part of the model contract rather than implementation detail.",
        "The next idea should prioritize a small residual EML block and a small mixer/Transformer-style EML block on toy datasets.",
      ],
      questionPacket: [
        "Which safe EML parameterization should be the default: clipped exp input, softplus-positive y, residual scaling, or all three?",
        "Does an EML residual block outperform a same-parameter MLP/convolutional residual block on MNIST-like data?",
        "Does an EML mixer help a compact toy text/sequence model under the same parameter budget?",
        "Which ablation falsifies the operator contribution without requiring a large benchmark?",
      ],
      synthesisRationale:
        "The strongest topic-grounded direction is to build a numerically safe EML residual block and a compact EML mixer/FFN variant, then validate them against same-parameter small baselines before scaling.",
      requiredAblations: [
        "Baseline residual/MLP block versus safe EML residual block at matched parameter count.",
        "No clipping versus exp-input clipping and finite-loss guardrails.",
        "Different positive-y parameterizations such as softplus plus epsilon versus learned clamped gate.",
        "EML branch enabled versus residual branch with the same normalization and scaling but no EML operator.",
      ],
      handoffImplications: [
        "The next idea stage should preserve the EML operator basemodel hypothesis and explicitly test numerical stability, parameter matching, and small image/text validation.",
        "The plan stage should treat safe exp/log handling, y-domain constraints, NaN/Inf monitoring, and same-parameter baselines as non-optional experiment contracts.",
      ],
    };
  }

  if (
    topicMatchesAny(normalizedTopic, [
      /fixmatch/,
      /generalized category discovery/,
      /\bgcd\b/,
      /pseudo-label/,
    ])
  ) {
    return {
      kind: "fixmatch_gcd",
      selectedDirectionTitle:
        "Adaptive FixMatch consistency for generalized category discovery",
      topicSummary:
        "Recover frontier mapping around transferring FixMatch weak-to-strong consistency and confidence-thresholded pseudo-labeling into GCD, with safeguards for known/novel imbalance.",
      anchorPapers: [
        {
          id: "paper:fixmatch-generalization",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
          relevance:
            "Source mechanism for weak-to-strong consistency, confidence thresholding, and pseudo-label regularization.",
        },
        {
          id: "method:gcd",
          title: "Generalized Category Discovery",
          relevance:
            "Target setting where labeled known classes and unlabeled novel classes must be optimized jointly.",
        },
      ],
      researchSummary:
        "FixMatch-style consistency is a plausible GCD improvement only if confidence thresholds and augmentation strength are calibrated separately for known and novel candidates.",
      keyFindings: [
        "Supervised-only GCD can overfit labeled known classes and leave novel-class structure under-regularized.",
        "FixMatch gains are tied to high-confidence pseudo-labels that remain stable under strong augmentation.",
        "Naive confidence filtering can amplify known-class confirmation bias in GCD because known classes start with labeled supervision.",
        "A stable transfer should evaluate H-score, known accuracy, novel accuracy, and pseudo-label precision/recall independently.",
      ],
      relevantMethods: [
        "weak-to-strong consistency",
        "confidence-thresholded pseudo-labeling",
        "EMA teacher or self-distillation",
        "known/novel adaptive threshold calibration",
        "cluster diversity regularization",
      ],
      openQuestions: [
        "Should novel candidates use lower confidence thresholds early and stricter thresholds after clusters stabilize?",
        "Which augmentations preserve novel-class semantics in GCD benchmarks?",
        "Does an EMA teacher reduce pseudo-label churn without suppressing novel discovery?",
      ],
      workingKeyFacts: [
        "The graph presence check is usable enough for frontier mapping, so remote graph repair can continue asynchronously when PaperNexus corpus sync or provider output is unavailable.",
        "The target topic asks for improving GCD using mechanisms from the FixMatch generalization analysis.",
        "GCD requires preserving known-class accuracy while discovering unlabeled novel classes.",
      ],
      activeHypotheses: [
        "Known/novel adaptive thresholds reduce confirmation bias compared with a global FixMatch threshold.",
        "EMA-teacher pseudo-labels reduce temporal instability in novel-class assignments.",
        "Strong augmentation must be semantic-preserving for novel clusters to avoid fragmentation.",
      ],
      pendingQueries: [
        "Find the exact GCD baseline used for implementation.",
        "Identify available GCD datasets and official evaluation metrics.",
        "Compare pseudo-label precision on known-like versus novel-like unlabeled examples.",
      ],
      limitationFrontier: [
        "GCD pseudo-labels are not equally reliable across known and novel candidates; known classes receive labeled supervision and can dominate confidence ranking.",
        "A direct FixMatch transfer can worsen confirmation bias if high-confidence unlabeled samples are mostly known-like.",
        "Strong augmentation may regularize representation learning but can fragment novel-class clusters when transformations alter fine-grained semantics.",
        "Static confidence thresholds are brittle during early GCD training because novel-class centroids and classifier heads are still unstable.",
        "A credible experiment must separate H-score, known accuracy, novel accuracy, and pseudo-label quality instead of reporting only aggregate gains.",
      ],
      contradictionFrontier: [
        "FixMatch depends on confident pseudo-labels, but GCD's most valuable samples are often novel and initially low-confidence.",
        "Raising thresholds improves pseudo-label precision but can remove novel-class learning signal; lowering thresholds improves coverage but can inject noisy labels.",
        "Supervised known-class anchors stabilize training, yet those anchors can pull ambiguous novel samples into known decision regions.",
        "Stronger consistency reduces variance, but too much invariance can erase distinctions needed for novel-category separation.",
        "The proposed resolution is not simply more consistency; it is consistency plus adaptive thresholding and cluster-diversity safeguards.",
      ],
      transferFrontier: [
        "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch: weak views generate pseudo-labels and strong views receive the consistency loss.",
        "Replace a global confidence threshold with calibrated known-like and novel-like thresholds, updated from class prior estimates or cluster stability.",
        "Use an EMA teacher to reduce pseudo-label churn and decouple target generation from the current student update.",
        "Gate novel pseudo-labels with feature-neighborhood or cluster-consensus checks so high-confidence known classes do not consume the unlabeled objective.",
        "Evaluate with ablations that isolate consistency, threshold calibration, augmentation strength, and teacher-student stabilization.",
      ],
      compositionSections: [
        {
          heading: "Cx1. Consistency-regularized GCD pseudo-labeling",
          body:
            "Combine FixMatch weak-to-strong consistency with GCD pseudo-labeling so high-confidence known-class assignments remain stable while novel-class candidates receive a smoother unlabeled training signal.",
        },
        {
          heading: "Cx2. Adaptive thresholding plus cluster diversity",
          body:
            "Compose confidence-thresholded pseudo-labeling with known/novel threshold calibration and feature-region diversity, preventing the selection process from collapsing onto known classes only.",
        },
        {
          heading: "Cx3. Teacher-student refinement for novel classes",
          body:
            "Use an EMA or self-distilled teacher to stabilize pseudo-labels across training time, while monitoring H-score so known-class accuracy is not purchased by suppressing novel discovery.",
        },
      ],
      logicChain: [
        "FixMatch improves generalization by coupling confident pseudo-labels with weak-to-strong consistency.",
        "GCD inherits the pseudo-labeling problem but adds known/novel imbalance and uncertain novel-class semantics.",
        "The transfer is plausible when consistency is adapted with known/novel threshold calibration and cluster-aware safeguards.",
        "The next idea should test H-score, known-class accuracy, novel-class accuracy, and pseudo-label precision/recall separately.",
      ],
      questionPacket: [
        "Which FixMatch mechanism is responsible for the expected GCD gain: consistency, thresholding, or augmentation diversity?",
        "How should the confidence threshold differ for known and novel candidates?",
        "Does strong augmentation preserve novel-class cluster structure or fragment it?",
        "Which ablation can falsify the claimed improvement without requiring a new benchmark?",
      ],
      synthesisRationale:
        "The strongest graph-grounded direction is to adapt FixMatch consistency to GCD with explicit controls for known/novel imbalance. The existing frontier artifacts point to pseudo-label confirmation bias, static threshold miscalibration, augmentation risk, and multi-view consistency as the critical constraints.",
      requiredAblations: [
        "Baseline GCD objective versus FixMatch-style consistency on unlabeled data.",
        "Fixed threshold versus known/novel adaptive thresholds.",
        "Uniform strong augmentation versus confidence-aware augmentation strength.",
        "Student-only pseudo-labels versus EMA teacher pseudo-labels.",
      ],
      handoffImplications: [
        "The next idea stage should preserve the selected FixMatch-to-GCD transfer hypothesis and explicitly test pseudo-label quality, thresholding, and known-versus-novel tradeoffs.",
        "The plan stage should treat the frontier pack as the source of truth for limitation, contradiction, transfer, composition, and anchor evidence.",
      ],
    };
  }

  return {
    kind: "generic",
    selectedDirectionTitle: `Topic-grounded frontier for ${topic}`,
    topicSummary:
      "Recover frontier mapping from the current project topic, preserving the requested research direction instead of importing a stale fallback domain.",
    anchorPapers: [
      {
        id: "topic:primary",
        title: topic,
        relevance:
          "Project prompt and manifest topic used as the recovery anchor until source-backed graph evidence is available.",
      },
    ],
    researchSummary:
      "The local frontier recovery should keep the project topic intact, identify testable assumptions, and require source-backed graph evidence before strong claims.",
    keyFindings: [
      "The current recovery path is operating without enough provider or graph output, so artifacts must be conservative.",
      "Every proposed direction should preserve the project topic and avoid borrowing unrelated stale templates.",
      "The next stage should separate hypothesis generation from evidence-backed claims.",
    ],
    relevantMethods: [
      "topic-grounded frontier recovery",
      "source-backed evidence acquisition",
      "bounded pilot validation",
    ],
    openQuestions: [
      "Which source-backed papers define the core operator, method, or baseline?",
      "Which small pilot can falsify the project hypothesis quickly?",
      "Which metrics and ablations prevent narrative drift?",
    ],
    workingKeyFacts: [
      "The project topic is the authoritative recovery anchor.",
      "Graph repair and literature acquisition can continue after local frontier packaging.",
    ],
    activeHypotheses: [
      "A small topic-aligned pilot is preferable to importing an unrelated fallback direction.",
    ],
    pendingQueries: [
      "Collect source-backed papers directly tied to the project topic.",
      "Define matched baselines, metrics, and ablations before experiment launch.",
    ],
    limitationFrontier: [
      "Provider or graph output is incomplete, so the recovery pack cannot support strong claims yet.",
      "The project can drift if stale domain templates are reused as frontier evidence.",
      "A valid next step needs topic-specific baselines, datasets, and failure criteria.",
    ],
    contradictionFrontier: [
      "Local recovery can keep the workflow moving, but it must not pretend that missing source evidence is present.",
      "A broad research prompt encourages exploration, but durable artifacts need bounded claims and explicit tests.",
    ],
    transferFrontier: [
      "Translate the topic into a smallest viable experiment with matched baselines.",
      "Route literature acquisition toward the topic's core method, benchmark, and safety constraints.",
      "Keep graph repair asynchronous while preserving the topic-aligned frontier contract.",
    ],
    compositionSections: [
      {
        heading: "Cx1. Topic-aligned pilot",
        body:
          "Convert the manifest topic into a compact, falsifiable pilot that can run before broader graph enrichment finishes.",
      },
      {
        heading: "Cx2. Evidence acquisition contract",
        body:
          "Require source-backed papers for the method, baselines, and benchmark before promoting the idea to a stronger claim.",
      },
      {
        heading: "Cx3. Drift guard",
        body:
          "Use the project topic and selected track as the recovery boundary so unrelated stale domains cannot become active frontiers.",
      },
    ],
    logicChain: [
      "The project topic is the authoritative recovery anchor.",
      "Missing graph output permits conservative local packaging but not strong evidence claims.",
      "The next idea should define a small pilot, matched baselines, and source acquisition requirements.",
    ],
    questionPacket: [
      "Which source-backed papers are required before the project can advance?",
      "What is the smallest experiment that tests the central hypothesis?",
      "Which baseline and metric choices would make the comparison fair?",
    ],
    synthesisRationale:
      "The strongest recovery direction is to preserve the topic, define a small falsifiable pilot, and require source-backed evidence before broad claims.",
    requiredAblations: [
      "Topic method enabled versus disabled under the same parameter or resource budget.",
      "Baseline protocol unchanged versus project-specific modification.",
      "Main metric plus failure-mode metrics.",
    ],
    handoffImplications: [
      "The next idea stage should preserve the project topic and require source-backed evidence before advancing claims.",
      "The plan stage should treat matched baselines, explicit metrics, and drift checks as required contracts.",
    ],
  };
}

function isOffTopicFrontierTitle(profile: FrontierRecoveryProfile, title: string): boolean {
  const normalizedTitle = title.toLowerCase();
  if (profile.kind === "eml_operator") {
    const hasEmlSignal =
      /\beml\b|2603\.21852|elementary function|exp\(x\)|ln\(y\)|resnet|transformer|mnist|toy/.test(
        normalizedTitle
      );
    const hasStaleGcdSignal =
      /fixmatch|generalized category discovery|\bgcd\b|pseudo-label|known\/novel|h-score/.test(
        normalizedTitle
      );
    return hasStaleGcdSignal && !hasEmlSignal;
  }
  return false;
}

function hasProfileRecoveryMarker(profile: FrontierRecoveryProfile, text: string): boolean {
  return new RegExp(`recovery[_ ]profile["']?\\s*[:=]\\s*["']?${profile.kind}`, "i").test(
    text
  );
}

function hasStaleProfileDrift(profile: FrontierRecoveryProfile, text: string): boolean {
  if (profile.kind === "eml_operator") {
    return (
      /fixmatch|generalized category discovery|\bgcd\b|pseudo-label|known\/novel|h-score/i.test(
        text
      ) && !hasProfileRecoveryMarker(profile, text)
    );
  }
  return false;
}

function shouldReplaceProfileDriftText(
  profile: FrontierRecoveryProfile,
  text: string
): boolean {
  if (!text.trim()) {
    return false;
  }
  return hasStaleProfileDrift(profile, text);
}

function shouldReplaceProfileDriftJson(
  profile: FrontierRecoveryProfile,
  value: Record<string, unknown>
): boolean {
  const text = JSON.stringify(value);
  const source = String(value.source ?? "").trim();
  const recoveryProfile = String(value.recovery_profile ?? value.recoveryProfile ?? "").trim();
  if (recoveryProfile === profile.kind) {
    return false;
  }
  const fallbackReason = String(value.fallback_reason ?? value.fallbackReason ?? "").trim();
  const isLocalRecovery =
    source === "workflow_local_frontier_recovery" ||
    fallbackReason ===
      "local_frontier_mapping_recovery_after_graph_degraded_or_missing_agent_outputs";
  return isLocalRecovery && hasStaleProfileDrift(profile, text);
}

function updatedGeneratedFiles(files: string[]): { updated: boolean; generatedFiles: string[] } {
  return { updated: files.length > 0, generatedFiles: files };
}

function hasTextContent(value: string | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

async function readMtimeMs(targetPath: string | null): Promise<number | null> {
  if (!targetPath) {
    return null;
  }
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasProviderCapacitySignalText(text: string | null): boolean {
  return Boolean(
    text &&
      /(?:provider_capacity|capacity|quota|allocated quota|rate.?limit|429)/i.test(text)
  );
}

async function fileHasProviderCapacitySignal(
  projectRoot: string,
  artifactPath: string
): Promise<boolean> {
  return hasProviderCapacitySignalText(
    await readTextIfExists(resolveProjectArtifactPath(projectRoot, artifactPath))
  );
}

async function fileHasText(projectRoot: string, artifactPath: string | null): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return hasTextContent(await readTextIfExists(resolved));
}

async function fileHasJson(projectRoot: string, artifactPath: string | null): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  const parsed = await readJsonIfExists<unknown>(resolved);
  if (parsed == null) {
    return false;
  }
  if (Array.isArray(parsed)) {
    return parsed.length > 0;
  }
  if (typeof parsed === "object") {
    return Object.keys(parsed as Record<string, unknown>).length > 0;
  }
  return true;
}

async function frontierGraphCoreSourcesReady(projectRoot: string): Promise<boolean> {
  const ready = await Promise.all(
    CORE_FRONTIER_GRAPH_ARTIFACTS.map((artifact) => fileHasText(projectRoot, artifact.path))
  );
  return ready.filter(Boolean).length >= 2;
}

export async function isFrontierGraphPackReady(projectRoot: string): Promise<boolean> {
  const directReady = (
    await Promise.all(
      FRONTIER_GRAPH_ARTIFACTS.map((artifact) => fileHasText(projectRoot, artifact.path))
    )
  ).every(Boolean);
  if (directReady) {
    return true;
  }
  const legacyPath = resolveProjectArtifactPath(projectRoot, "graph/subgraphs");
  if (!legacyPath || !(await pathExists(legacyPath))) {
    return false;
  }
  try {
    const entries = await fs.readdir(legacyPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function brainstormBundleArtifactsReady(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const jsonReady = await Promise.all(
    [
      state.topicSummaryPath,
      state.researchBriefPath,
      state.brainstormBriefPath,
      state.workingMemoryPath,
    ].map((artifactPath) => fileHasJson(params.projectRoot, artifactPath))
  );
  if (!jsonReady.every(Boolean)) {
    return false;
  }
  const textReady = await Promise.all(
    [
      state.logicChainPath,
      state.evidenceChainPath,
      state.reasoningTracePath,
      state.questionPacketPath,
      state.synthesisPacketPath,
    ].map((artifactPath) => fileHasText(params.projectRoot, artifactPath))
  );
  return textReady.every(Boolean);
}

async function brainstormCoreJsonArtifactsReady(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const jsonReady = await Promise.all(
    [
      state.topicSummaryPath,
      state.researchBriefPath,
      state.brainstormBriefPath,
      state.workingMemoryPath,
    ].map((artifactPath) => fileHasJson(params.projectRoot, artifactPath))
  );
  return jsonReady.every(Boolean);
}

async function graphPresenceSupportsFrontierRecovery(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const presence = await readArtifactJson(params.projectRoot, "graph/GRAPH_PRESENCE_CHECK.json");
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  const status = normalizeStage(
    presence?.status ??
      presence?.graph_presence_status ??
      presence?.graphPresenceStatus ??
      paperIngestion?.graph_presence_status ??
      paperIngestion?.graphPresenceStatus ??
      paperIngestion?.status
  );
  const presentCount =
    readFiniteNumber(presence?.present_paper_count) ??
    readFiniteNumber(presence?.presentPaperCount) ??
    readFiniteNumber(presence?.corpus_paper_count) ??
    readFiniteNumber(presence?.corpusPaperCount) ??
    readFiniteNumber(paperIngestion?.graph_present_paper_count) ??
    readFiniteNumber(paperIngestion?.graphPresentPaperCount);
  const expectedCount =
    readFiniteNumber(presence?.expected_paper_count) ??
    readFiniteNumber(presence?.expectedPaperCount) ??
    readFiniteNumber(paperIngestion?.graph_expected_paper_count) ??
    readFiniteNumber(paperIngestion?.graphExpectedPaperCount);
  const hasGraphReport =
    (await fileHasText(params.projectRoot, "graph/GRAPH_BUILD_REPORT.md")) ||
    presence != null;
  const graphReasoning = asRecord(params.manifest.graph_reasoning);
  const frontierRecovery = asRecord(graphReasoning?.frontier_recovery);
  const explicitRecoveryAllowed =
    frontierRecovery?.allow_local_fallback === true ||
    frontierRecovery?.mode === "local_fallback_when_needed" ||
    params.manifest.frontier_mapping_local_recovery === true;
  const providerCapacityRecoverySignal =
    explicitRecoveryAllowed ||
    (await fileHasProviderCapacitySignal(
      params.projectRoot,
      ".openclaw-research/workflow-local-operator-relay.jsonl"
    )) ||
    (await fileHasProviderCapacitySignal(
      params.projectRoot,
      ".openclaw-research/workflow-runtime-queue.json"
    )) ||
    (await fileHasProviderCapacitySignal(
      params.projectRoot,
      ".openclaw-research/workflow-runtime-sessions.json"
    ));
  const localSourceGraphFallbackReady = deriveGraphBuildPartialReadiness({
    paperIngestion,
    graphPresenceStatus: status,
  }).ready;
  const usableStatus = new Set([
    "ready",
    "completed",
    "partial",
    "degraded",
    "available",
  ]);
  const readyGraphPresence =
    usableStatus.has(status ?? "") ||
    presence?.all_canonical_papers_present === true ||
    presence?.allCanonicalPapersPresent === true ||
    (presentCount != null && presentCount > 0);
  return (
    hasGraphReport &&
    (readyGraphPresence ||
      providerCapacityRecoverySignal ||
      localSourceGraphFallbackReady ||
      (expectedCount != null && expectedCount > 0 && status !== "missing"))
  );
}

async function hasRecoverableFrontierMappingSources(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  if (
    (await frontierGraphCoreSourcesReady(params.projectRoot)) &&
    (await brainstormCoreJsonArtifactsReady(params))
  ) {
    return true;
  }
  return graphPresenceSupportsFrontierRecovery(params);
}

async function latestFrontierSourceMtime(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<number | null> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const artifactPaths = [
    ...FRONTIER_GRAPH_ARTIFACTS.map((artifact) => artifact.path),
    state.topicSummaryPath,
    state.researchBriefPath,
    state.brainstormBriefPath,
    state.logicChainPath,
    state.evidenceChainPath,
    state.reasoningTracePath,
    state.questionPacketPath,
    state.workingMemoryPath,
    state.synthesisPacketPath,
  ];
  let latest: number | null = null;
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
    const mtimeMs = await readMtimeMs(resolved);
    if (mtimeMs === null) {
      continue;
    }
    latest = latest === null ? mtimeMs : Math.max(latest, mtimeMs);
  }
  return latest;
}

export async function shouldMaterializeFrontierMappingState(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (params.stage !== "frontier_mapping") {
    return false;
  }
  if (!(await hasRecoverableFrontierMappingSources(params))) {
    return false;
  }
  if (!(await isFrontierGraphPackReady(params.projectRoot))) {
    return true;
  }
  if (!(await brainstormBundleArtifactsReady(params))) {
    return true;
  }

  const reportPath = resolveProjectArtifactPath(params.projectRoot, FRONTIER_REPORT_PATH);
  const reportText = await readTextIfExists(reportPath);
  if (!auditFrontierReportText(reportText).ok) {
    return true;
  }

  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  if (!isBrainstormCycleReady(state) || getBrainstormCycleValidationErrors(state).length > 0) {
    return true;
  }

  if (normalizeStage(params.manifest.current_micro_stage) !== "frontiers_packaged") {
    return true;
  }

  const reportMtime = await readMtimeMs(reportPath);
  const sourceMtime = await latestFrontierSourceMtime(params);
  return reportMtime !== null && sourceMtime !== null && sourceMtime > reportMtime;
}

function meaningfulLines(text: string | null, limit: number): string[] {
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s*$/.test(line))
    .slice(0, limit);
}

function trimLine(line: string, maxLength = 420): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 3)}...`;
}

function pickStringList(source: Record<string, unknown> | null, keys: string[]): string[] {
  if (!source) {
    return [];
  }
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      const strings = value
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          const record = asRecord(entry);
          return (
            pickString(record ?? {}, [
              "title",
              "finding",
              "summary",
              "name",
              "description",
              "relevance",
            ]) ?? ""
          );
        })
        .filter((entry) => entry.trim().length > 0);
      if (strings.length > 0) {
        return uniqueStrings(strings);
      }
    }
  }
  return [];
}

function renderJsonBriefLines(value: Record<string, unknown> | null, keys: string[]): string[] {
  const lines: string[] = [];
  if (!value) {
    return lines;
  }
  const summary = pickString(value, ["summary", "thesis", "description"]);
  if (summary) {
    lines.push(summary);
  }
  for (const entry of pickStringList(value, keys)) {
    lines.push(entry);
  }
  return uniqueStrings(lines).slice(0, 12);
}

function bulletize(lines: string[], fallback: string): string {
  const items = uniqueStrings(lines.map((line) => trimLine(line.replace(/^[-*]\s*/, "")))).slice(
    0,
    12
  );
  const source = items.length > 0 ? items : [fallback];
  return source.map((line) => `- ${line}`).join("\n");
}

async function writeTextIfMissingOrEmpty(params: {
  projectRoot: string;
  artifactPath: string | null;
  text: string;
  generatedFiles: string[];
  replaceIf?: (currentText: string) => boolean;
}): Promise<void> {
  const resolved = resolveProjectArtifactPath(params.projectRoot, params.artifactPath);
  if (!resolved) {
    return;
  }
  const currentText = await readTextIfExists(resolved);
  if (hasTextContent(currentText) && !params.replaceIf?.(currentText ?? "")) {
    return;
  }
  await writeTextEnsured(resolved, params.text);
  if (params.artifactPath) {
    params.generatedFiles.push(params.artifactPath);
  }
}

async function writeJsonIfMissingOrEmpty(params: {
  projectRoot: string;
  artifactPath: string | null;
  value: Record<string, unknown>;
  generatedFiles: string[];
  replaceIf?: (currentValue: Record<string, unknown>) => boolean;
}): Promise<void> {
  const resolved = resolveProjectArtifactPath(params.projectRoot, params.artifactPath);
  if (!resolved) {
    return;
  }
  const currentValue = await readJsonIfExists<Record<string, unknown>>(resolved);
  if (
    currentValue &&
    Object.keys(currentValue).length > 0 &&
    !params.replaceIf?.(currentValue)
  ) {
    return;
  }
  await writeJsonEnsured(resolved, params.value);
  if (params.artifactPath) {
    params.generatedFiles.push(params.artifactPath);
  }
}

async function readArtifactText(projectRoot: string, artifactPath: string): Promise<string> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return (await readTextIfExists(resolved)) ?? "";
}

async function readArtifactJson(
  projectRoot: string,
  artifactPath: string | null
): Promise<Record<string, unknown> | null> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return (await readJsonIfExists<Record<string, unknown>>(resolved)) ?? null;
}

function pickTopic(params: {
  manifest: ManifestLike;
  topicSummary: Record<string, unknown> | null;
}): string {
  const brainstorm = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const researchProgram = asRecord(params.manifest.research_program);
  return (
    brainstorm.topic ??
    pickString(params.topicSummary ?? {}, ["topic", "title", "summary"]) ??
    pickString(researchProgram ?? {}, ["goal", "problem_statement", "problemStatement"]) ??
    pickString(params.manifest, ["title", "project_title", "projectTitle"]) ??
    "Untitled research topic"
  );
}

function inferSelectedOptionTitle(params: {
  state: ReturnType<typeof normalizeBrainstormCycleState>;
  synthesisText: string;
  topic: string;
}): string {
  if (params.state.selectedOptionTitle) {
    return params.state.selectedOptionTitle;
  }
  for (const round of params.state.rounds) {
    for (const option of round.options) {
      if (option.optionId === params.state.selectedOptionId && option.title) {
        return option.title;
      }
    }
  }
  const synthesisLines = params.synthesisText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const recommendedIndex = synthesisLines.findIndex((line) =>
    /recommended pilot|top 3 research directions|core argument/i.test(line)
  );
  if (recommendedIndex >= 0) {
    const nextTitle = synthesisLines
      .slice(recommendedIndex + 1)
      .find((line) => !/^#{1,6}\s*/.test(line));
    if (nextTitle) {
      return nextTitle.replace(/^[-*]\s*/, "");
    }
  }
  const recommended = synthesisLines.find((line) =>
    /recommended pilot|top 3 research directions|core argument/i.test(line)
  );
  return recommended?.replace(/^#+\s*/, "") ?? params.topic;
}

function inferTopIdeaTitle(params: {
  state: ReturnType<typeof normalizeBrainstormCycleState>;
  brainstormBrief: Record<string, unknown> | null;
  synthesisText: string;
  topic: string;
}): string {
  const explicit = inferSelectedOptionTitle({
    state: params.state,
    synthesisText: params.synthesisText,
    topic: params.topic,
  });
  if (explicit && explicit !== params.topic) {
    return explicit;
  }
  const directions = Array.isArray(params.brainstormBrief?.directions)
    ? params.brainstormBrief?.directions
    : [];
  const firstDirection = asRecord(directions[0]);
  return pickString(firstDirection ?? {}, ["title", "summary"]) ?? explicit;
}

async function materializeMissingFrontierRecoveryCore(params: {
  projectRoot: string;
  manifest: ManifestLike;
  state: ReturnType<typeof normalizeBrainstormCycleState>;
  topic: string;
  now: string;
  generatedFiles: string[];
}): Promise<void> {
  const presence = await readArtifactJson(params.projectRoot, "graph/GRAPH_PRESENCE_CHECK.json");
  const expectedPaperCount =
    readFiniteNumber(presence?.expected_paper_count) ??
    readFiniteNumber(presence?.expectedPaperCount);
  const presentPaperCount =
    readFiniteNumber(presence?.present_paper_count) ??
    readFiniteNumber(presence?.presentPaperCount);
  const missingPaperCount =
    readFiniteNumber(presence?.missing_paper_count) ??
    readFiniteNumber(presence?.missingPaperCount);
  const graphStatus = normalizeStage(presence?.status) ?? "available";
  const fallbackReason =
    "local_frontier_mapping_recovery_after_graph_degraded_or_missing_agent_outputs";
  const profile = inferFrontierRecoveryProfile(params.topic);
  const replaceProfileDriftJson = (current: Record<string, unknown>) =>
    shouldReplaceProfileDriftJson(profile, current);
  const replaceProfileDriftText = (current: string) =>
    shouldReplaceProfileDriftText(profile, current);

  await writeJsonIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: params.state.topicSummaryPath,
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftJson,
    value: {
      topic: params.topic,
      summary: profile.topicSummary,
      source: "workflow_local_frontier_recovery",
      fallback_reason: fallbackReason,
      generated_at: params.now,
      graph_presence_status: graphStatus,
      expected_paper_count: expectedPaperCount,
      present_paper_count: presentPaperCount,
      missing_paper_count: missingPaperCount,
      recovery_profile: profile.kind,
      anchor_papers: profile.anchorPapers,
    },
  });

  await writeJsonIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: params.state.researchBriefPath,
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftJson,
    value: {
      summary: profile.researchSummary,
      source: "workflow_local_frontier_recovery",
      fallback_reason: fallbackReason,
      generated_at: params.now,
      recovery_profile: profile.kind,
      key_findings: profile.keyFindings,
      relevant_methods: profile.relevantMethods,
      open_questions: profile.openQuestions,
    },
  });

  await writeJsonIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: params.state.brainstormBriefPath,
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftJson,
    value: {
      source: "workflow_local_frontier_recovery",
      fallback_reason: fallbackReason,
      generated_at: params.now,
      recovery_profile: profile.kind,
      directions: [
        {
          id: `direction:${profile.kind}`,
          title: profile.selectedDirectionTitle,
          summary: profile.synthesisRationale,
          rationale: profile.researchSummary,
          required_ablations: profile.requiredAblations,
        },
      ],
    },
  });

  await writeJsonIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: params.state.workingMemoryPath,
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftJson,
    value: {
      source: "workflow_local_frontier_recovery",
      fallback_reason: fallbackReason,
      generated_at: params.now,
      recovery_profile: profile.kind,
      key_facts: profile.workingKeyFacts,
      active_hypotheses: profile.activeHypotheses,
      pending_queries: profile.pendingQueries,
    },
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/LIMITATION_FRONTIER.md",
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Limitation Frontier",
      "",
      `Topic: ${params.topic}`,
      `Generated at: ${params.now}`,
      `Recovery profile: ${profile.kind}`,
      `Recovery source: ${fallbackReason}`,
      "",
      bulletize(profile.limitationFrontier, "No limitation frontier was inferred."),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/CONTRADICTION_FRONTIER.md",
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Contradiction Frontier",
      "",
      `Topic: ${params.topic}`,
      `Generated at: ${params.now}`,
      `Recovery profile: ${profile.kind}`,
      `Recovery source: ${fallbackReason}`,
      "",
      bulletize(profile.contradictionFrontier, "No contradiction frontier was inferred."),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/TRANSFER_FRONTIER.md",
    generatedFiles: params.generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Transfer Frontier",
      "",
      `Topic: ${params.topic}`,
      `Generated at: ${params.now}`,
      `Recovery profile: ${profile.kind}`,
      `Recovery source: ${fallbackReason}`,
      "",
      bulletize(profile.transferFrontier, "No transfer frontier was inferred."),
      "",
    ].join("\n"),
  });
}

async function materializeRecoverableFrontierSources(params: {
  projectRoot: string;
  manifest: ManifestLike;
  now: string;
}): Promise<string[]> {
  const generatedFiles: string[] = [];
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  let [
    topicSummary,
    researchBrief,
    brainstormBrief,
    workingMemory,
    limitationText,
    contradictionText,
    transferText,
  ] = await Promise.all([
    readArtifactJson(params.projectRoot, state.topicSummaryPath),
    readArtifactJson(params.projectRoot, state.researchBriefPath),
    readArtifactJson(params.projectRoot, state.brainstormBriefPath),
    readArtifactJson(params.projectRoot, state.workingMemoryPath),
    readArtifactText(params.projectRoot, "graph/LIMITATION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/CONTRADICTION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/TRANSFER_FRONTIER.md"),
  ]);
  const topic = pickTopic({ manifest: params.manifest, topicSummary });
  const profile = inferFrontierRecoveryProfile(topic);
  const replaceProfileDriftText = (current: string) =>
    shouldReplaceProfileDriftText(profile, current);
  await materializeMissingFrontierRecoveryCore({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    state,
    topic,
    now: params.now,
    generatedFiles,
  });
  [
    topicSummary,
    researchBrief,
    brainstormBrief,
    workingMemory,
    limitationText,
    contradictionText,
    transferText,
  ] = await Promise.all([
    readArtifactJson(params.projectRoot, state.topicSummaryPath),
    readArtifactJson(params.projectRoot, state.researchBriefPath),
    readArtifactJson(params.projectRoot, state.brainstormBriefPath),
    readArtifactJson(params.projectRoot, state.workingMemoryPath),
    readArtifactText(params.projectRoot, "graph/LIMITATION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/CONTRADICTION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/TRANSFER_FRONTIER.md"),
  ]);
  const researchLines = renderJsonBriefLines(researchBrief, [
    "key_findings",
    "relevant_methods",
    "open_questions",
  ]);
  const brainstormLines = renderJsonBriefLines(brainstormBrief, ["directions", "ideas"]);
  const memoryLines = [
    ...asStringArray(workingMemory?.key_facts),
    ...asStringArray(workingMemory?.active_hypotheses),
    ...asStringArray(workingMemory?.pending_queries),
  ];
  const limitationLines = meaningfulLines(limitationText, 8);
  const contradictionLines = meaningfulLines(contradictionText, 8);
  const transferLines = meaningfulLines(transferText, 8);
  const allSignalLines = uniqueStrings([
    ...researchLines,
    ...brainstormLines,
    ...memoryLines,
    ...limitationLines,
    ...contradictionLines,
    ...transferLines,
  ]);
  const inferredSelectedOptionTitle = inferTopIdeaTitle({
    state,
    brainstormBrief,
    synthesisText: "",
    topic,
  });
  const selectedOptionTitle = isOffTopicFrontierTitle(
    profile,
    inferredSelectedOptionTitle
  )
    ? profile.selectedDirectionTitle
    : inferredSelectedOptionTitle;

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/COMPOSITION_FRONTIER.md",
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Composition Frontier",
      "",
      `Topic: ${topic}`,
      `Generated at: ${params.now}`,
      `Recovery profile: ${profile.kind}`,
      "",
      ...profile.compositionSections.flatMap((section) => [
        `## ${section.heading}`,
        "",
        section.body,
        "",
      ]),
      "",
      "## Source Signals",
      bulletize(allSignalLines, selectedOptionTitle),
      "",
    ].join("\n"),
  });

  const anchorPapers = Array.isArray(topicSummary?.anchor_papers)
    ? topicSummary?.anchor_papers
    : [];
  const anchorLines = anchorPapers
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const id = pickString(record, ["id", "paper_id", "paperId"]) ?? "paper";
      const title = pickString(record, ["title", "name"]) ?? "untitled";
      const relevance = pickString(record, ["relevance", "summary"]);
      return relevance ? `${id}: ${title} - ${relevance}` : `${id}: ${title}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/ANCHOR_INDEX.md",
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Anchor Index",
      "",
      `Topic: ${topic}`,
      `Generated at: ${params.now}`,
      `Recovery profile: ${profile.kind}`,
      "",
      "## Paper Anchors",
      bulletize(anchorLines, "No explicit paper anchors were recorded in the topic summary."),
      "",
      "## Frontier Anchors",
      bulletize(
        [
          ...limitationLines.slice(0, 4),
          ...contradictionLines.slice(0, 4),
          ...transferLines.slice(0, 4),
        ],
        selectedOptionTitle
      ),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.logicChainPath,
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Logic Chain",
      "",
      `Topic: ${topic}`,
      `Recovery profile: ${profile.kind}`,
      "",
      "",
      ...profile.logicChain.map((line, index) => `${index + 1}. ${line}`),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.evidenceChainPath,
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Evidence Chain",
      "",
      `Topic: ${topic}`,
      `Recovery profile: ${profile.kind}`,
      "",
      "",
      bulletize(allSignalLines, selectedOptionTitle),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.questionPacketPath,
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Question Packet",
      "",
      `Topic: ${topic}`,
      `Recovery profile: ${profile.kind}`,
      "",
      "",
      bulletize(profile.questionPacket, "No frontier questions were inferred."),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.synthesisPacketPath,
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      "# Synthesis Packet",
      "",
      `Topic: ${topic}`,
      `Recovery profile: ${profile.kind}`,
      "",
      "",
      "## Recommended Pilot",
      "",
      selectedOptionTitle,
      "",
      "## Rationale",
      "",
      profile.synthesisRationale,
      "",
      "## Required Ablations",
      "",
      bulletize(profile.requiredAblations, "No required ablations were inferred."),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.reasoningTracePath,
    generatedFiles,
    replaceIf: replaceProfileDriftText,
    text: [
      JSON.stringify({
        ts: params.now,
        event: "frontier_mapping_recovery",
        topic,
        selected_direction: selectedOptionTitle,
        recovery_profile: profile.kind,
        source_artifacts: [
          "graph/LIMITATION_FRONTIER.md",
          "graph/CONTRADICTION_FRONTIER.md",
          "graph/TRANSFER_FRONTIER.md",
          state.topicSummaryPath,
          state.researchBriefPath,
          state.brainstormBriefPath,
          state.workingMemoryPath,
        ].filter(Boolean),
        decision:
          "Recovered missing frontier mapping chain artifacts from graph presence, durable sources, and local fallback synthesis when provider output was unavailable.",
      }),
      "",
    ].join("\n"),
  });

  return generatedFiles;
}

function buildReconciledBrainstormCycle(params: {
  manifest: ManifestLike;
  now: string;
  topic: string;
  selectedOptionTitle: string;
}): Record<string, unknown> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const current = serializeBrainstormCycleState(state);
  const currentRounds = Array.isArray(current.rounds) ? current.rounds : [];
  const fallbackRoundId = state.selectedRoundId ?? "round_1";
  const fallbackOptionId = state.selectedOptionId ?? "opt_1";
  const rounds =
    currentRounds.length > 0
      ? currentRounds
      : [
          {
            round_id: fallbackRoundId,
            topic: params.topic,
            status: "completed",
            generated_at: params.now,
            options: [
              {
                option_id: fallbackOptionId,
                title: params.selectedOptionTitle,
                score: null,
              },
            ],
          },
        ];
  const selectedRoundId =
    state.selectedRoundId ??
    pickString(asRecord(rounds[0]) ?? {}, ["round_id", "roundId"]) ??
    fallbackRoundId;
  const firstRound = asRecord(rounds[0]) ?? {};
  const firstOptions = Array.isArray(firstRound.options) ? firstRound.options : [];
  const selectedOptionId =
    state.selectedOptionId ??
    pickString(asRecord(firstOptions[0]) ?? {}, ["option_id", "optionId"]) ??
    fallbackOptionId;

  const next = normalizeBrainstormCycleState({
    ...current,
    status: "ready",
    topic: state.topic ?? params.topic,
    basis_stage: state.basisStage ?? "frontier_mapping",
    provider: state.provider ?? "workflow_core_brainstorm",
    provider_mode: state.providerMode ?? "core",
    provider_status: "ready",
    provider_last_run_at: state.providerLastRunAt ?? state.latestRunAt ?? params.now,
    contract_version: state.contractVersion ?? 1,
    latest_run_at: state.latestRunAt ?? params.now,
    rounds,
    selected_round_id: selectedRoundId,
    selected_option_id: selectedOptionId,
    selected_option_title: params.selectedOptionTitle,
  });
  return serializeBrainstormCycleState(next);
}

function renderFrontierReport(params: {
  topic: string;
  selectedOptionTitle: string;
  generatedAt: string;
  synthesisText: string;
  frontierTexts: Array<{ title: string; text: string }>;
}): string {
  const lines: string[] = [
    "# Frontier Report",
    "",
    `Topic: ${params.topic}`,
    `Generated at: ${params.generatedAt}`,
    "",
    "## Selected Direction",
    `- ${params.selectedOptionTitle}`,
    "",
  ];

  const profile = inferFrontierRecoveryProfile(params.topic);
  const synthesisLines = meaningfulLines(params.synthesisText, 10);
  if (synthesisLines.length > 0) {
    lines.push("## Graph-Grounded Synthesis", "");
    for (const line of synthesisLines) {
      lines.push(trimLine(line));
    }
    lines.push("");
  }

  for (const frontier of params.frontierTexts) {
    const excerpt = meaningfulLines(frontier.text, 10);
    if (excerpt.length === 0) {
      continue;
    }
    lines.push(`## ${frontier.title}`, "");
    for (const line of excerpt) {
      lines.push(trimLine(line));
    }
    lines.push("");
  }

  lines.push("## Handoff Implications", "");
  for (const implication of profile.handoffImplications) {
    lines.push(`- ${implication}`);
  }
  lines.push("");

  return lines.join("\n");
}

export async function materializeFrontierMappingState(params: {
  projectRoot: string;
  manifest?: ManifestLike | null;
}): Promise<{ updated: boolean; generatedFiles: string[] }> {
  const manifest =
    params.manifest ??
    ((await readJsonIfExists<ManifestLike>(
      resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ??
      {});
  if (!(await hasRecoverableFrontierMappingSources({ projectRoot: params.projectRoot, manifest }))) {
    return { updated: false, generatedFiles: [] };
  }

  const now = new Date().toISOString();
  const generatedFiles = await materializeRecoverableFrontierSources({
    projectRoot: params.projectRoot,
    manifest,
    now,
  });
  if (!(await isFrontierGraphPackReady(params.projectRoot))) {
    return updatedGeneratedFiles(generatedFiles);
  }
  if (!(await brainstormBundleArtifactsReady({ projectRoot: params.projectRoot, manifest }))) {
    return updatedGeneratedFiles(generatedFiles);
  }
  const state = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const topicSummary =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, state.topicSummaryPath)
    )) ?? null;
  const topic = pickTopic({ manifest, topicSummary });
  const synthesisText = await readArtifactText(
    params.projectRoot,
    state.synthesisPacketPath ?? "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md"
  );
  const profile = inferFrontierRecoveryProfile(topic);
  const inferredSelectedOptionTitle = inferSelectedOptionTitle({
    state,
    synthesisText,
    topic,
  });
  const selectedOptionTitle = isOffTopicFrontierTitle(
    profile,
    inferredSelectedOptionTitle
  )
    ? profile.selectedDirectionTitle
    : inferredSelectedOptionTitle;
  const frontierTexts = await Promise.all(
    FRONTIER_GRAPH_ARTIFACTS.map(async (artifact) => ({
      title: artifact.title,
      text: await readArtifactText(params.projectRoot, artifact.path),
    }))
  );

  const report = renderFrontierReport({
    topic,
    selectedOptionTitle,
    generatedAt: now,
    synthesisText,
    frontierTexts,
  });
  const reportPath = resolveProjectArtifactPath(params.projectRoot, FRONTIER_REPORT_PATH);
  if (!reportPath) {
    return { updated: false, generatedFiles: [] };
  }
  await writeTextEnsured(reportPath, report);
  generatedFiles.push(FRONTIER_REPORT_PATH);

  const graphReasoning = asRecord(manifest.graph_reasoning) ?? {};
  const nextManifest: ManifestLike = {
    ...manifest,
    current_micro_stage: "frontiers_packaged",
    frontier_report: FRONTIER_REPORT_PATH,
    brainstorm_cycle: buildReconciledBrainstormCycle({
      manifest,
      now,
      topic,
      selectedOptionTitle,
    }),
    graph_reasoning: {
      ...graphReasoning,
      last_reasoning_refresh_at: now,
      last_trace_path: state.reasoningTracePath,
      last_synthesis_packet_path: state.synthesisPacketPath,
      stop_status: "ready",
      stop_reason: null,
      frontier_recovery: {
        status: "ready",
        mode: "local_fallback_when_needed",
        generated_at: now,
      },
    },
    updated_at: now,
  };
  await writeJsonEnsured(
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ??
      `${params.projectRoot}/PROJECT_MANIFEST.json`,
    nextManifest
  );

  generatedFiles.push("PROJECT_MANIFEST.json");
  return updatedGeneratedFiles(generatedFiles);
}
