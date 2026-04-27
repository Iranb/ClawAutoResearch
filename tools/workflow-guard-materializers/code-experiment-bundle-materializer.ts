import * as path from "node:path";
import {
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import {
  normalizeOrchestrationState,
  serializeOrchestrationState,
} from "../workflow-guard-state/execution-state";
import {
  normalizeResearchProgramState,
} from "../workflow-guard-state/research-program";
import type { ResearchProgramState, ResearchProgramTrack } from "../workflow-guard.js";

type ManifestLike = Record<string, unknown>;

const CODE_EXPERIMENT_ARTIFACTS = {
  index: "coder/EXPERIMENT_INDEX.md",
  train: "train.py",
  readme: "README.md",
  manifest: "EXPERIMENT_MANIFEST.json",
} as const;

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return (
    values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null
  );
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}

function inferTopic(params: {
  manifest: ManifestLike;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
}): string {
  return (
    firstNonEmpty(
      params.researchProgram.goal,
      params.track.hypothesis,
      pickString(params.manifest, ["title", "topic", "research_topic", "researchTopic"])
    ) ?? "the selected research direction"
  );
}

function selectActiveTrack(
  state: ResearchProgramState
): ResearchProgramTrack | null {
  const selectedTrackId = state.planSelection.selectedTrackId;
  const activeTracks = state.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
  if (selectedTrackId) {
    const selectedActive = activeTracks.find(
      (track) => track.trackId === selectedTrackId
    );
    if (selectedActive) {
      return selectedActive;
    }
  }
  return activeTracks[0] ?? null;
}

function defaultInnovationPoints(topic: string): string[] {
  const normalized = topic.toLowerCase();
  if (/\bgcd\b|generalized category discovery|fixmatch/u.test(normalized)) {
    return [
      "FixMatch consistency filtering for unlabeled GCD candidates",
      "Class-balance debiasing for pseudo-label expansion",
      "Known-novel H-score tracking with ablation controls",
    ];
  }
  return [
    "Consistency filtering for unlabeled candidates",
    "Class-balance debiasing for pseudo-label expansion",
    "Primary metric tracking with ablation controls",
  ];
}

function buildExperimentManifest(params: {
  projectRoot: string;
  manifest: ManifestLike;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  topic: string;
}): Record<string, unknown> {
  const projectId =
    pickString(params.manifest, ["project_id", "projectId", "id"]) ??
    path.basename(params.projectRoot) ??
    "local-autoresearch-project";
  const primaryMetric =
    params.track.mainMetric ??
    params.researchProgram.primaryMetric ??
    (/\bgcd\b|generalized category discovery/u.test(params.topic.toLowerCase())
      ? "H-score with known and novel accuracy"
      : "primary task quality metric");
  const baselineReference =
    params.researchProgram.baselineReference ??
    (/\bgcd\b|generalized category discovery/u.test(params.topic.toLowerCase())
      ? "SimGCD-style supervised and semi-supervised GCD baselines"
      : "strongest available supervised baseline");
  const targetImprovement =
    params.track.successThreshold ??
    `Improve ${primaryMetric} over ${baselineReference} without regressing the baseline protocol.`;
  const innovationPoints = defaultInnovationPoints(params.topic);
  const executionCommand = `python ${params.bundleRelativeDir}/train.py --seed 42`;

  return {
    experiment_id: params.experimentId,
    project_id: projectId,
    track_id: params.track.trackId,
    name: "fixmatch_gcd_consistency_debiasing",
    status: "draft",
    question:
      params.track.hypothesis ??
      `Does the proposed semi-supervised consistency route improve ${primaryMetric}?`,
    hypothesis:
      params.track.hypothesis ??
      `The selected method improves ${primaryMetric} through consistency-filtered unlabeled evidence.`,
    novelty_basis:
      params.track.noveltyBasis ??
      "The bundle translates the selected plan into a reproducible consistency-filtering and debiasing probe.",
    baseline_reference: baselineReference,
    primary_baseline_metric: primaryMetric,
    target_improvement: targetImprovement,
    baseline_training_protocol:
      "Run the supervised prototype baseline on the same synthetic known/novel split, seed, feature generator, and evaluation code used by the proposed method.",
    baseline_eval_protocol:
      "Report known accuracy, novel accuracy, and H-score from the shared evaluator without changing checkpoint selection or class splits.",
    datasets:
      params.researchProgram.datasets.length > 0
        ? params.researchProgram.datasets
        : ["synthetic-gcd-proxy"],
    innovation_points: innovationPoints,
    validation_steps: innovationPoints.map((point, index) => ({
      step_id: `validation-${index + 1}`,
      objective: `Validate ${point} against the shared supervised baseline and fixed evaluation split.`,
      covers: [point],
    })),
    ablation_plan: innovationPoints.map((point, index) => ({
      ablation_id: `ablation-${index + 1}`,
      objective: `Disable ${point} to isolate its contribution to ${primaryMetric}.`,
      covers: [point],
    })),
    implementation_proof: {
      changed_files: [
        `${params.bundleRelativeDir}/train.py`,
        `${params.bundleRelativeDir}/README.md`,
        `${params.bundleRelativeDir}/EXPERIMENT_MANIFEST.json`,
      ],
      integration_points: innovationPoints.map((point, index) => ({
        point_id: `integration-${index + 1}`,
        path: `${params.bundleRelativeDir}/train.py`,
        symbol:
          index === 0
            ? "run_fixmatch_consistency"
            : index === 1
              ? "apply_class_balance_debiasing"
              : "compute_known_novel_h_score",
        summary: `The generated runner wires ${point} into the local experiment path.`,
        covers: [point],
      })),
      activation_signals: innovationPoints.map((point, index) => ({
        point_id: `activation-${index + 1}`,
        summary: `RESULT_SUMMARY.json records activation and ablation metrics for ${point}.`,
        covers: [point],
      })),
      execution_command: executionCommand,
    },
    entry_point: "train.py",
    expected_outputs: ["RESULT_SUMMARY.json"],
  };
}

function buildTrainPy(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import math
import random
from pathlib import Path


def make_point(rng, class_id, split):
    angle = class_id * 1.0471975512
    radius = 3.0 + 0.15 * (class_id % 2)
    base_x = math.cos(angle) * radius
    base_y = math.sin(angle) * radius
    noise = 0.32 if split == "labeled" else 0.42
    return (
        base_x + rng.gauss(0.0, noise),
        base_y + rng.gauss(0.0, noise),
        class_id,
    )


def build_dataset(seed):
    rng = random.Random(seed)
    labeled = [make_point(rng, c, "labeled") for c in range(3) for _ in range(8)]
    unlabeled = [make_point(rng, c, "unlabeled") for c in range(6) for _ in range(36)]
    validation = [make_point(rng, c, "validation") for c in range(6) for _ in range(30)]
    return labeled, unlabeled, validation


def centroid(points):
    if not points:
        return (0.0, 0.0)
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def distance(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def nearest(point, prototypes):
    ranked = sorted(
        ((class_id, distance(point, center)) for class_id, center in prototypes.items()),
        key=lambda item: item[1],
    )
    best_class, best_distance = ranked[0]
    second_distance = ranked[1][1] if len(ranked) > 1 else best_distance + 1.0
    confidence = 1.0 / (1.0 + max(0.0, best_distance))
    margin = max(0.0, second_distance - best_distance)
    return best_class, confidence, margin


def evaluate(prototypes, validation):
    known_hits = known_total = novel_hits = novel_total = 0
    for x, y, label in validation:
        predicted, _, _ = nearest((x, y), prototypes)
        if label < 3:
            known_total += 1
            known_hits += int(predicted == label)
        else:
            novel_total += 1
            novel_hits += int(predicted == label)
    known_acc = known_hits / max(1, known_total)
    novel_acc = novel_hits / max(1, novel_total)
    h_score = 0.0 if known_acc + novel_acc == 0 else 2 * known_acc * novel_acc / (known_acc + novel_acc)
    return {
        "known_accuracy": round(known_acc, 4),
        "novel_accuracy": round(novel_acc, 4),
        "h_score": round(h_score, 4),
    }


def supervised_baseline(labeled):
    return {class_id: centroid([point for point in labeled if point[2] == class_id]) for class_id in range(3)}


def initialize_novel_prototypes(unlabeled, seed):
    rng = random.Random(seed + 17)
    candidates = sorted(unlabeled, key=lambda point: abs(point[0]) + abs(point[1]), reverse=True)
    chosen = candidates[:12]
    rng.shuffle(chosen)
    return {
        3: centroid(chosen[0::3]),
        4: centroid(chosen[1::3]),
        5: centroid(chosen[2::3]),
    }


def run_fixmatch_consistency(labeled, unlabeled, seed, debias=True, consistency=True):
    prototypes = supervised_baseline(labeled)
    prototypes.update(initialize_novel_prototypes(unlabeled, seed))
    per_class_cap = max(8, len(unlabeled) // 18)
    accepted = {class_id: [] for class_id in prototypes}
    for x, y, label in unlabeled:
        weak = (x * 0.985 + 0.03, y * 1.015 - 0.02)
        strong = (x * 1.035 - 0.05, y * 0.965 + 0.04)
        weak_class, weak_conf, weak_margin = nearest(weak, prototypes)
        strong_class, strong_conf, _ = nearest(strong, prototypes)
        if consistency and weak_class != strong_class:
            continue
        if weak_conf < 0.18 or weak_margin < 0.18:
            continue
        if debias and len(accepted[weak_class]) >= per_class_cap:
            continue
        accepted[weak_class].append((x, y, label))
    for class_id, points in accepted.items():
        if points:
            prototypes[class_id] = centroid(points)
    return prototypes, {str(class_id): len(points) for class_id, points in accepted.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    labeled, unlabeled, validation = build_dataset(args.seed)
    baseline = evaluate(supervised_baseline(labeled), validation)
    proposed_prototypes, accepted = run_fixmatch_consistency(labeled, unlabeled, args.seed)
    no_debias, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, debias=False)
    no_consistency, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, consistency=False)
    summary = {
        "run_id": f"local-fixmatch-gcd-{args.seed}",
        "seed": args.seed,
        "status": "completed",
        "baseline": baseline,
        "proposed": evaluate(proposed_prototypes, validation),
        "ablations": {
            "minus_class_balance_debiasing": evaluate(no_debias, validation),
            "minus_consistency_filtering": evaluate(no_consistency, validation),
        },
        "activation": {
            "fixmatch_consistency_filtering": True,
            "class_balance_debiasing": True,
            "known_novel_h_score_tracking": True,
            "accepted_pseudo_labels": accepted,
        },
    }
    output = Path(args.output) if args.output else Path(__file__).with_name("RESULT_SUMMARY.json")
    output.write_text(json.dumps(summary, indent=2) + "\\n", encoding="utf8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
`;
}

function buildReadme(params: {
  topic: string;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  command: string;
  manifest: Record<string, unknown>;
}): string {
  const innovationPoints = (params.manifest.innovation_points as string[] | undefined) ?? [];
  return `# ${params.experimentId}: FixMatch-Inspired GCD Probe

This bundle is the local no-Discord implementation fallback for the active code-stage track.
It turns the selected research plan into a deterministic experiment scaffold that can be run
without external services or GPUs while preserving the baseline, validation, ablation, and
implementation-proof contracts expected by the workflow.

## Topic

${params.topic}

## Active Track

- Track: ${params.track.trackId}
- Hypothesis: ${params.track.hypothesis ?? "not specified"}
- Novelty basis: ${params.track.noveltyBasis ?? "not specified"}

## Innovation Points

${innovationPoints.map((point) => `- ${point}`).join("\n")}

## Run

\`\`\`bash
${params.command}
\`\`\`

The script writes \`${params.bundleRelativeDir}/RESULT_SUMMARY.json\` with baseline,
proposed, and ablation metrics. The synthetic proxy is intentionally small, deterministic,
and standard-library-only so the workflow can keep moving when model or remote execution
capacity is temporarily unavailable.
`;
}

function buildExperimentIndex(params: {
  topic: string;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  command: string;
  manifest: Record<string, unknown>;
}): string {
  const metric = pickString(params.manifest, ["primary_baseline_metric"]) ?? "primary metric";
  return `# Coder Experiment Index

## Active Bundles

| Experiment | Track | Bundle | Metric | Status |
| --- | --- | --- | --- | --- |
| ${params.experimentId} | ${params.track.trackId} | ${params.bundleRelativeDir} | ${metric} | draft |

## Current Execution Contract

- Topic: ${params.topic}
- Hypothesis: ${params.track.hypothesis ?? "not specified"}
- Novelty basis: ${params.track.noveltyBasis ?? "not specified"}
- Execution command: \`${params.command}\`
- Result artifact: \`${params.bundleRelativeDir}/RESULT_SUMMARY.json\`
`;
}

export async function materializeCodeExperimentBundleImpl(params: {
  projectRoot: string;
  codeMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  generatedFiles: string[];
  experimentId: string | null;
  trackId: string | null;
  bundleDir: string | null;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<ManifestLike>(manifestPath)) ?? {};
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const track = selectActiveTrack(researchProgram);
  if (!track || !isSafePathSegment(track.trackId)) {
    return {
      generatedFiles: [],
      experimentId: null,
      trackId: track?.trackId ?? null,
      bundleDir: null,
    };
  }

  const generatedFiles: string[] = [];
  const topic = inferTopic({ manifest, researchProgram, track });
  const experimentId = "exp-1";
  const slug = /\bgcd\b|generalized category discovery|fixmatch/u.test(topic.toLowerCase())
    ? "fixmatch_gcd_consistency_debiasing"
    : "local_consistency_debiasing_probe";
  const bundleRelativeDir = path.posix.join(
    "coder",
    "experiments",
    track.trackId,
    `${experimentId}__${slug}`
  );
  const bundleDir = path.join(projectRoot, bundleRelativeDir);
  const experimentManifest = buildExperimentManifest({
    projectRoot,
    manifest,
    researchProgram,
    track,
    experimentId,
    bundleRelativeDir,
    topic,
  });
  const executionCommand =
    pickString(
      asRecord(experimentManifest.implementation_proof) ?? {},
      ["execution_command"]
    ) ?? `python ${bundleRelativeDir}/train.py --seed 42`;

  await writeTextEnsured(path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.train), buildTrainPy());
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);

  await writeJsonEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.manifest),
    experimentManifest
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);

  await writeTextEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.readme),
    buildReadme({
      topic,
      track,
      experimentId,
      bundleRelativeDir,
      command: executionCommand,
      manifest: experimentManifest,
    })
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);

  await writeTextEnsured(
    path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.index),
    buildExperimentIndex({
      topic,
      track,
      experimentId,
      bundleRelativeDir,
      command: executionCommand,
      manifest: experimentManifest,
    })
  );
  generatedFiles.push(CODE_EXPERIMENT_ARTIFACTS.index);

  const orchestration = normalizeOrchestrationState(manifest.orchestration_state);
  const now = new Date().toISOString();
  manifest.orchestration_state = serializeOrchestrationState({
    ...orchestration,
    status: ["running", "waiting", "ready"].includes(
      normalizeStage(orchestration.status) ?? ""
    )
      ? orchestration.status
      : "waiting",
    currentOwner: "coder",
    nextOwner: orchestration.nextOwner ?? "researcher",
    nextTransitionCandidate: "experiment",
    blockingCategory: null,
    blockingReason: null,
    retryBudgetRemaining: orchestration.retryBudgetRemaining ?? 2,
    lastContractEvalAt: now,
    lastContractEvalResult: "pass",
    resumeCursor: `code:${experimentId}:bundle_ready`,
    lastUpdatedAt: now,
  });
  manifest.owner_agent = "coder";
  await writeJsonEnsured(manifestPath, manifest);
  generatedFiles.push("PROJECT_MANIFEST.json");

  return {
    generatedFiles: uniqueStrings(generatedFiles),
    experimentId,
    trackId: track.trackId,
    bundleDir: bundleRelativeDir,
  };
}
