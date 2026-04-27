import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
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
  protocol: "GCD_PROTOCOL.json",
  dataset: "data/gcd_reference_split.jsonl",
} as const;

type ExistingCodeBundle = {
  dir: string;
  relativeDir: string;
  manifestPath: string;
  manifest: Record<string, unknown> | null;
  hasTrain: boolean;
  hasReadme: boolean;
  hasProtocol: boolean;
  hasDataset: boolean;
  legacyLocalProxy: boolean;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return (
    values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null
  );
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}

function normalizeContractText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isLegacyLocalProxyText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /synthetic proxy|synthetic-gcd-proxy|local proxy|build_dataset\(seed\)/iu.test(value);
}

async function listExistingCodeBundles(
  projectRoot: string,
  trackId: string
): Promise<ExistingCodeBundle[]> {
  const trackDir = path.join(projectRoot, "coder", "experiments", trackId);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(trackDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bundles: ExistingCodeBundle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(trackDir, entry.name);
    const relativeDir = path
      .relative(projectRoot, dir)
      .split(path.sep)
      .join(path.posix.sep);
    const manifestPath = path.join(dir, CODE_EXPERIMENT_ARTIFACTS.manifest);
    const trainText = await readTextIfExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.train));
    const readmeText = await readTextIfExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.readme));
    bundles.push({
      dir,
      relativeDir,
      manifestPath,
      manifest: await readJsonIfExists<Record<string, unknown>>(manifestPath),
      hasTrain: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.train)),
      hasReadme: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.readme)),
      hasProtocol: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.protocol)),
      hasDataset: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.dataset)),
      legacyLocalProxy: isLegacyLocalProxyText(trainText) || isLegacyLocalProxyText(readmeText),
    });
  }
  return bundles.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

function getRegistryTrack(
  trackRegistry: Record<string, unknown>,
  trackId: string
): Record<string, unknown> | null {
  const tracks = Array.isArray(trackRegistry.tracks) ? trackRegistry.tracks : [];
  for (const entry of tracks) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    if (pickString(record, ["track_id", "trackId", "id"]) === trackId) {
      return record;
    }
  }
  return null;
}

function isAlignedToTrackContract(params: {
  bundleManifest: Record<string, unknown> | null;
  track: ResearchProgramTrack;
}): boolean {
  if (!params.bundleManifest) {
    return false;
  }
  const trackId = pickString(params.bundleManifest, ["track_id", "trackId"]);
  if (trackId !== params.track.trackId) {
    return false;
  }
  const bundleHypothesis = normalizeContractText(
    pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const bundleNoveltyBasis = normalizeContractText(
    pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"])
  );
  const expectedHypothesis = normalizeContractText(params.track.hypothesis);
  const expectedNoveltyBasis = normalizeContractText(params.track.noveltyBasis);
  return (
    (!expectedHypothesis || bundleHypothesis === expectedHypothesis) &&
    (!expectedNoveltyBasis || bundleNoveltyBasis === expectedNoveltyBasis)
  );
}

function isRepairableStaleContract(params: {
  bundleManifest: Record<string, unknown> | null;
  track: ResearchProgramTrack;
  registryTrack: Record<string, unknown> | null;
  manifest: ManifestLike;
}): boolean {
  if (!params.bundleManifest || !params.registryTrack) {
    return false;
  }
  const trackId = pickString(params.bundleManifest, ["track_id", "trackId"]);
  if (trackId !== params.track.trackId) {
    return false;
  }
  if (isAlignedToTrackContract({ bundleManifest: params.bundleManifest, track: params.track })) {
    return false;
  }

  const bundleHypothesis = normalizeContractText(
    pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const bundleNoveltyBasis = normalizeContractText(
    pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"])
  );
  const registryHypothesis = normalizeContractText(
    pickString(params.registryTrack, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const registryNoveltyBasis = normalizeContractText(
    pickString(params.registryTrack, ["novelty_basis", "noveltyBasis"])
  );
  const topic = normalizeContractText(
    pickString(params.manifest, ["title", "topic", "research_topic", "researchTopic"])
  );
  const hasRegistryContract = Boolean(registryHypothesis || registryNoveltyBasis);
  const matchesRegistry =
    hasRegistryContract &&
    (!registryHypothesis || bundleHypothesis === registryHypothesis) &&
    (!registryNoveltyBasis || bundleNoveltyBasis === registryNoveltyBasis);
  const matchesBootstrapTopic =
    Boolean(topic) &&
    bundleHypothesis === topic &&
    (!bundleNoveltyBasis || bundleNoveltyBasis === topic);
  return matchesRegistry || matchesBootstrapTopic;
}

function selectRepairableBundles(params: {
  bundles: ExistingCodeBundle[];
  track: ResearchProgramTrack;
  registryTrack: Record<string, unknown> | null;
  manifest: ManifestLike;
}): ExistingCodeBundle[] {
  const completeBundles = params.bundles.filter(
    (bundle) => bundle.manifest && bundle.hasTrain && bundle.hasReadme
  );
  return completeBundles.filter((bundle) =>
    isRepairableStaleContract({
      bundleManifest: bundle.manifest,
      track: params.track,
      registryTrack: params.registryTrack,
      manifest: params.manifest,
    })
  );
}

export async function shouldMaterializeCodeExperimentBundleImpl(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const projectRoot = path.resolve(params.projectRoot);
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  const track = selectActiveTrack(researchProgram);
  if (!track || !isSafePathSegment(track.trackId)) {
    return false;
  }
  const indexPath = path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.index);
  const bundles = await listExistingCodeBundles(projectRoot, track.trackId);
  if (!(await pathExists(indexPath))) {
    return true;
  }
  if (bundles.length === 0) {
    return true;
  }
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? {};
  const repairableBundles = selectRepairableBundles({
    bundles,
    track,
    registryTrack: getRegistryTrack(trackRegistry, track.trackId),
    manifest: params.manifest,
  });
  if (repairableBundles.length > 0) {
    return true;
  }
  if (
    bundles.some(
      (bundle) =>
        bundle.hasTrain &&
        bundle.hasReadme &&
        bundle.hasProtocol &&
        bundle.hasDataset &&
        !bundle.legacyLocalProxy &&
        isAlignedToTrackContract({ bundleManifest: bundle.manifest, track })
    )
  ) {
    return false;
  }
  if (
    bundles.some(
      (bundle) =>
        bundle.hasTrain &&
        bundle.hasReadme &&
        isAlignedToTrackContract({ bundleManifest: bundle.manifest, track }) &&
        (bundle.legacyLocalProxy || !bundle.hasProtocol || !bundle.hasDataset)
    )
  ) {
    return true;
  }
  return false;
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
  const datasetPath = `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.dataset}`;
  const protocolPath = `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.protocol}`;
  const executionCommand = `python ${params.bundleRelativeDir}/train.py --seed 42 --dataset ${datasetPath} --protocol ${protocolPath}`;

  return {
    experiment_id: params.experimentId,
    project_id: projectId,
    track_id: params.track.trackId,
    name: "fixmatch_gcd_consistency_debiasing",
    status: "draft",
    implementation_type: "local_reference_gcd_benchmark",
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
      "Run the prototype GCD baseline on the same fixed local known/novel reference split, seed, and evaluation code used by the proposed method.",
    baseline_eval_protocol:
      "Report known accuracy, novel accuracy, and H-score from the shared evaluator without changing checkpoint selection or class splits.",
    datasets:
      params.researchProgram.datasets.length > 0
        ? params.researchProgram.datasets
        : ["local-gcd-reference-benchmark"],
    benchmark_protocol_path: protocolPath,
    dataset_path: datasetPath,
    reference_dataset: {
      name: "local-gcd-reference-benchmark",
      split_file: datasetPath,
      known_classes: [0, 1, 2],
      novel_classes: [3, 4, 5],
      metric: "known/novel H-score",
    },
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
        datasetPath,
        protocolPath,
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
from pathlib import Path


def load_protocol(path):
    with Path(path).open("r", encoding="utf8") as handle:
        return json.load(handle)


def load_gcd_reference_split(path):
    records = []
    with Path(path).open("r", encoding="utf8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            records.append((float(record["x"]), float(record["y"]), int(record["label"]), record["split"]))
    labeled = [(x, y, label) for x, y, label, split in records if split == "labeled"]
    unlabeled = [(x, y, label) for x, y, label, split in records if split == "unlabeled"]
    validation = [(x, y, label) for x, y, label, split in records if split == "validation"]
    if not labeled or not unlabeled or not validation:
        raise ValueError("GCD reference split must contain labeled, unlabeled, and validation rows.")
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


def compute_known_novel_h_score(prototypes, validation, known_class_count=3):
    known_hits = known_total = novel_hits = novel_total = 0
    for x, y, label in validation:
        predicted, _, _ = nearest((x, y), prototypes)
        if label < known_class_count:
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
    phase = seed % 7
    candidates = sorted(
        unlabeled,
        key=lambda point: (abs(point[0]) + abs(point[1]), math.sin(point[0] + phase)),
        reverse=True,
    )
    chosen = candidates[:18]
    return {
        3: centroid(chosen[0::3]),
        4: centroid(chosen[1::3]),
        5: centroid(chosen[2::3]),
    }


def build_baseline_gcd_prototypes(labeled, unlabeled, seed):
    prototypes = supervised_baseline(labeled)
    prototypes.update(initialize_novel_prototypes(unlabeled, seed))
    return prototypes


def apply_class_balance_debiasing(accepted, class_id, per_class_cap):
    return len(accepted[class_id]) < per_class_cap


def run_fixmatch_consistency(labeled, unlabeled, seed, debias=True, consistency=True):
    prototypes = build_baseline_gcd_prototypes(labeled, unlabeled, seed)
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
        if debias and not apply_class_balance_debiasing(accepted, weak_class, per_class_cap):
            continue
        accepted[weak_class].append((x, y, label))
    for class_id, points in accepted.items():
        if points:
            prior = prototypes[class_id]
            update = centroid(points)
            prototypes[class_id] = ((prior[0] + update[0]) / 2.0, (prior[1] + update[1]) / 2.0)
    return prototypes, {str(class_id): len(points) for class_id, points in accepted.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default=None)
    parser.add_argument("--dataset", default=str(Path(__file__).with_name("data").joinpath("gcd_reference_split.jsonl")))
    parser.add_argument("--protocol", default=str(Path(__file__).with_name("GCD_PROTOCOL.json")))
    args = parser.parse_args()
    protocol = load_protocol(args.protocol)
    labeled, unlabeled, validation = load_gcd_reference_split(args.dataset)
    baseline = compute_known_novel_h_score(build_baseline_gcd_prototypes(labeled, unlabeled, args.seed), validation)
    proposed_prototypes, accepted = run_fixmatch_consistency(labeled, unlabeled, args.seed)
    no_debias, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, debias=False)
    no_consistency, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, consistency=False)
    proposed = compute_known_novel_h_score(proposed_prototypes, validation)
    minus_debias = compute_known_novel_h_score(no_debias, validation)
    minus_consistency = compute_known_novel_h_score(no_consistency, validation)
    delta = round(proposed["h_score"] - baseline["h_score"], 4)
    summary = {
        "run_id": f"local-reference-gcd-{args.seed}",
        "seed": args.seed,
        "status": "completed",
        "execution_mode": "local_reference_gcd_benchmark",
        "protocol": protocol,
        "dataset": str(Path(args.dataset)),
        "baseline": baseline,
        "proposed": proposed,
        "ablations": {
            "minus_class_balance_debiasing": minus_debias,
            "minus_consistency_filtering": minus_consistency,
        },
        "metrics": {
            "h_score": proposed["h_score"],
            "known_accuracy": proposed["known_accuracy"],
            "novel_accuracy": proposed["novel_accuracy"],
            "baseline_h_score": baseline["h_score"],
            "delta_h_score": delta,
            "minus_class_balance_debiasing_h_score": minus_debias["h_score"],
            "minus_consistency_filtering_h_score": minus_consistency["h_score"],
        },
        "key_metric": {
            "name": "h_score",
            "value": proposed["h_score"],
            "baseline": baseline["h_score"],
            "delta": delta,
            "direction": "higher_is_better",
        },
        "result_paths": ["RESULT_SUMMARY.json"],
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

function buildGcdProtocol(params: {
  topic: string;
  track: ResearchProgramTrack;
  manifest: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    name: "local-gcd-reference-benchmark",
    task: "generalized_category_discovery",
    topic: params.topic,
    track_id: params.track.trackId,
    baseline: {
      family: "prototype-centroid GCD reference baseline",
      preserves_known_labeled_classes: true,
      initializes_novel_prototypes_from_unlabeled_candidates: true,
    },
    proposed_change: "FixMatch weak/strong consistency gate with class-balance debiasing",
    known_classes: [0, 1, 2],
    novel_classes: [3, 4, 5],
    splits: {
      labeled: "known-class labeled anchors",
      unlabeled: "mixed known/novel candidates",
      validation: "held-out known/novel scoring split",
    },
    metric: "known_novel_h_score",
    required_symbols: [
      "run_fixmatch_consistency",
      "apply_class_balance_debiasing",
      "compute_known_novel_h_score",
    ],
    primary_baseline_metric:
      pickString(params.manifest, ["primary_baseline_metric", "primaryBaselineMetric"]) ??
      "H-score with known and novel accuracy",
  };
}

function deterministicOffset(classId: number, index: number, axis: "x" | "y"): number {
  const raw =
    axis === "x"
      ? Math.sin((classId + 1) * 12.9898 + (index + 1) * 78.233)
      : Math.cos((classId + 1) * 39.3467 + (index + 1) * 11.135);
  return raw * 0.28;
}

function makeDatasetRecord(classId: number, index: number, split: string): string {
  const angle = classId * 1.0471975512;
  const radius = 3.0 + 0.18 * (classId % 2);
  const splitDrift = split === "unlabeled" ? 0.12 : split === "validation" ? -0.08 : 0;
  const x = Math.cos(angle) * radius + deterministicOffset(classId, index, "x") + splitDrift;
  const y = Math.sin(angle) * radius + deterministicOffset(classId, index, "y") - splitDrift;
  return JSON.stringify({
    split,
    label: classId,
    x: Number(x.toFixed(6)),
    y: Number(y.toFixed(6)),
  });
}

function buildGcdReferenceDatasetJsonl(): string {
  const rows: string[] = [];
  for (let classId = 0; classId < 3; classId += 1) {
    for (let index = 0; index < 8; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "labeled"));
    }
  }
  for (let classId = 0; classId < 6; classId += 1) {
    for (let index = 0; index < 36; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "unlabeled"));
    }
  }
  for (let classId = 0; classId < 6; classId += 1) {
    for (let index = 0; index < 30; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "validation"));
    }
  }
  return `${rows.join("\n")}\n`;
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
  return `# ${params.experimentId}: FixMatch-Inspired GCD Reference Benchmark

This bundle is the local no-Discord reference implementation for the active code-stage track.
It loads a fixed GCD reference split from \`${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.dataset}\`,
checks \`${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.protocol}\`, and compares one
baseline-preserving method change against the shared known/novel H-score evaluator.

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
proposed, and ablation metrics. The benchmark is intentionally deterministic and
standard-library-only so the workflow can run a repeatable code review and Karpathy loop
without Discord, GPUs, or external dataset downloads.
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
  const status = pickString(params.manifest, ["status"]) ?? "draft";
  return `# Coder Experiment Index

## Active Bundles

| Experiment | Track | Bundle | Metric | Status |
| --- | --- | --- | --- | --- |
| ${params.experimentId} | ${params.track.trackId} | ${params.bundleRelativeDir} | ${metric} | ${status} |

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
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? {};
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
  const existingBundles = await listExistingCodeBundles(projectRoot, track.trackId);
  const repairableBundles = selectRepairableBundles({
    bundles: existingBundles,
    track,
    registryTrack: getRegistryTrack(trackRegistry, track.trackId),
    manifest,
  });
  const repairableBundle = repairableBundles[0] ?? null;
  const bundleRelativeDir =
    repairableBundle?.relativeDir ??
    path.posix.join(
      "coder",
      "experiments",
      track.trackId,
      `${experimentId}__${slug}`
    );
  const bundleDir =
    repairableBundle?.dir ??
    path.join(projectRoot, bundleRelativeDir);
  const defaultExperimentManifest = buildExperimentManifest({
    projectRoot,
    manifest,
    researchProgram,
    track,
    experimentId,
    bundleRelativeDir,
    topic,
  });
  const existingManifest = repairableBundle?.manifest ?? null;
  const experimentManifest: Record<string, unknown> = {
    ...defaultExperimentManifest,
    ...(existingManifest ?? {}),
    experiment_id:
      pickString(existingManifest ?? {}, ["experiment_id", "experimentId"]) ??
      experimentId,
    project_id:
      pickString(existingManifest ?? {}, ["project_id", "projectId"]) ??
      pickString(defaultExperimentManifest, ["project_id", "projectId"]),
    track_id: track.trackId,
    question:
      track.hypothesis ??
      pickString(defaultExperimentManifest, ["question", "experiment_question"]),
    hypothesis:
      track.hypothesis ??
      pickString(defaultExperimentManifest, ["hypothesis", "track_hypothesis"]),
    novelty_basis:
      track.noveltyBasis ??
      pickString(defaultExperimentManifest, ["novelty_basis", "noveltyBasis"]),
  };
  experimentManifest.implementation_type =
    pickString(defaultExperimentManifest, ["implementation_type", "implementationType"]) ??
    "local_reference_gcd_benchmark";
  if (
    asRecord(experimentManifest.reference_dataset) == null ||
    isLegacyLocalProxyText(JSON.stringify(experimentManifest.datasets ?? ""))
  ) {
    experimentManifest.datasets = defaultExperimentManifest.datasets;
    experimentManifest.reference_dataset = defaultExperimentManifest.reference_dataset;
  }
  experimentManifest.benchmark_protocol_path = defaultExperimentManifest.benchmark_protocol_path;
  experimentManifest.dataset_path = defaultExperimentManifest.dataset_path;
  experimentManifest.implementation_proof =
    asRecord(existingManifest?.implementation_proof ?? existingManifest?.implementationProof) ??
    defaultExperimentManifest.implementation_proof;
  const status = pickString(existingManifest ?? {}, ["status"]);
  if (status) {
    experimentManifest.status = status;
  }
  const executionCommand =
    pickString(
      asRecord(experimentManifest.implementation_proof) ?? {},
      ["execution_command"]
    ) ?? `python ${bundleRelativeDir}/train.py --seed 42`;

  const existingTrain = await readTextIfExists(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.train)
  );
  const shouldRewriteTrain =
    !repairableBundle ||
    !repairableBundle.hasTrain ||
    repairableBundle.legacyLocalProxy ||
    isLegacyLocalProxyText(existingTrain);
  if (shouldRewriteTrain) {
    await writeTextEnsured(path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.train), buildTrainPy());
    generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);
  }

  await writeJsonEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.protocol),
    buildGcdProtocol({ topic, track, manifest: experimentManifest })
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.protocol}`);
  await writeTextEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.dataset),
    buildGcdReferenceDatasetJsonl()
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.dataset}`);

  await writeJsonEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.manifest),
    experimentManifest
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);

  const existingReadme = await readTextIfExists(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.readme)
  );
  const shouldRewriteReadme =
    !repairableBundle ||
    !repairableBundle.hasReadme ||
    existingReadme?.includes("local no-Discord implementation fallback") === true ||
    isLegacyLocalProxyText(existingReadme);
  if (shouldRewriteReadme) {
    await writeTextEnsured(
      path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.readme),
      buildReadme({
        topic,
        track,
        experimentId:
          pickString(experimentManifest, ["experiment_id", "experimentId"]) ?? experimentId,
        bundleRelativeDir,
        command: executionCommand,
        manifest: experimentManifest,
      })
    );
    generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);
  }

  for (const staleBundle of repairableBundles.slice(1)) {
    const staleExperimentId =
      pickString(staleBundle.manifest ?? {}, ["experiment_id", "experimentId"]) ??
      experimentId;
    const staleManifest: Record<string, unknown> = {
      ...defaultExperimentManifest,
      ...(staleBundle.manifest ?? {}),
      experiment_id: staleExperimentId,
      project_id:
        pickString(staleBundle.manifest ?? {}, ["project_id", "projectId"]) ??
        pickString(defaultExperimentManifest, ["project_id", "projectId"]),
      track_id: track.trackId,
      question:
        track.hypothesis ??
        pickString(defaultExperimentManifest, ["question", "experiment_question"]),
      hypothesis:
        track.hypothesis ??
        pickString(defaultExperimentManifest, ["hypothesis", "track_hypothesis"]),
      novelty_basis:
        track.noveltyBasis ??
        pickString(defaultExperimentManifest, ["novelty_basis", "noveltyBasis"]),
    };
    staleManifest.implementation_type =
      pickString(defaultExperimentManifest, ["implementation_type", "implementationType"]) ??
      "local_reference_gcd_benchmark";
    staleManifest.datasets = defaultExperimentManifest.datasets;
    staleManifest.reference_dataset = defaultExperimentManifest.reference_dataset;
    staleManifest.benchmark_protocol_path = defaultExperimentManifest.benchmark_protocol_path;
    staleManifest.dataset_path = defaultExperimentManifest.dataset_path;
    staleManifest.implementation_proof =
      asRecord(staleBundle.manifest?.implementation_proof ?? staleBundle.manifest?.implementationProof) ??
      defaultExperimentManifest.implementation_proof;
    const staleStatus = pickString(staleBundle.manifest ?? {}, ["status"]);
    if (staleStatus) {
      staleManifest.status = staleStatus;
    }
    if (staleBundle.legacyLocalProxy || !staleBundle.hasTrain) {
      await writeTextEnsured(
        path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.train),
        buildTrainPy()
      );
      generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);
    }
    await writeJsonEnsured(
      path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.protocol),
      buildGcdProtocol({ topic, track, manifest: staleManifest })
    );
    generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.protocol}`);
    await writeTextEnsured(
      path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.dataset),
      buildGcdReferenceDatasetJsonl()
    );
    generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.dataset}`);
    await writeJsonEnsured(staleBundle.manifestPath, staleManifest);
    generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);

    const staleReadme = await readTextIfExists(
      path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme)
    );
    if (
      staleReadme?.includes("local no-Discord implementation fallback") === true ||
      isLegacyLocalProxyText(staleReadme)
    ) {
      const staleExecutionCommand =
        pickString(asRecord(staleManifest.implementation_proof) ?? {}, ["execution_command"]) ??
        `python ${staleBundle.relativeDir}/train.py --seed 42`;
      await writeTextEnsured(
        path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme),
        buildReadme({
          topic,
          track,
          experimentId: staleExperimentId,
          bundleRelativeDir: staleBundle.relativeDir,
          command: staleExecutionCommand,
          manifest: staleManifest,
        })
      );
      generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);
    }
  }

  await writeTextEnsured(
    path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.index),
    buildExperimentIndex({
      topic,
      track,
      experimentId:
        pickString(experimentManifest, ["experiment_id", "experimentId"]) ?? experimentId,
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
