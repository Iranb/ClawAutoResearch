import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  asStringArray,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  buildOneChangeSignature,
  collectBaselineDatasetEnvelope,
  collectInnovationAnchorPoints,
} from "../workflow-experiment-loop";

export type ExperimentSearchContractDefaults = {
  oneChangeSignature: string | null;
  baselineDatasetEnvelope: string[];
  innovationAnchorPoints: string[];
  bundleDatasetEnvelope: string[];
};

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

async function readExperimentBundleManifests(params: {
  projectRoot: string;
  trackId?: string | null;
  experimentId?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const coderRoot = path.join(params.projectRoot, "coder");
  const queue: Array<{ dir: string; depth: number }> = [{ dir: coderRoot, depth: 0 }];
  const manifests: Array<Record<string, unknown>> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const manifestPath = path.join(current.dir, "EXPERIMENT_MANIFEST.json");
    const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
    if (manifest) {
      manifests.push(manifest);
      continue;
    }

    if (current.depth >= 5) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "__pycache__") {
        continue;
      }
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return manifests.sort((left, right) => {
    const leftTrack = pickString(left, ["track_id", "trackId"]);
    const rightTrack = pickString(right, ["track_id", "trackId"]);
    const leftExperiment = pickString(left, ["experiment_id", "experimentId"]);
    const rightExperiment = pickString(right, ["experiment_id", "experimentId"]);
    const leftScore =
      (params.trackId && leftTrack === params.trackId ? 2 : 0) +
      (params.experimentId && leftExperiment === params.experimentId ? 1 : 0);
    const rightScore =
      (params.trackId && rightTrack === params.trackId ? 2 : 0) +
      (params.experimentId && rightExperiment === params.experimentId ? 1 : 0);
    return rightScore - leftScore;
  });
}

function bundleOneChangeCandidates(bundleManifests: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    compactStrings(
      bundleManifests.flatMap((manifest) => [
        pickString(manifest, [
          "one_change_signature",
          "oneChangeSignature",
          "one_variable_change",
          "oneVariableChange",
        ]),
        ...asStringArray(manifest.innovation_points ?? manifest.innovationPoints),
        pickString(manifest, ["hypothesis"]),
        pickString(manifest, ["novelty_basis", "noveltyBasis"]),
        pickString(manifest, ["target_improvement", "targetImprovement"]),
      ])
    )
  );
}

export async function inferExperimentSearchContractDefaults(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  trackRecords: Array<Record<string, unknown>>;
  trackId?: string | null;
  experimentId?: string | null;
}): Promise<ExperimentSearchContractDefaults> {
  const bundleManifests = await readExperimentBundleManifests({
    projectRoot: params.projectRoot,
    trackId: params.trackId,
    experimentId: params.experimentId,
  });
  const bundleDatasetEnvelope = uniqueStrings(
    bundleManifests.flatMap((manifest) => asStringArray(manifest.datasets))
  );
  const baselineDatasetEnvelope = uniqueStrings([
    ...collectBaselineDatasetEnvelope({
      manifest: params.manifest,
      trackRecords: params.trackRecords,
    }),
    ...bundleDatasetEnvelope,
  ]);
  const innovationAnchorPoints = uniqueStrings([
    ...collectInnovationAnchorPoints({
      manifest: params.manifest,
      trackRecords: params.trackRecords,
    }),
  ]);
  const bundleRecord =
    bundleOneChangeCandidates(bundleManifests)[0] ??
    buildOneChangeSignature({ trackRecords: params.trackRecords }) ??
    null;

  return {
    oneChangeSignature: bundleRecord,
    baselineDatasetEnvelope,
    innovationAnchorPoints,
    bundleDatasetEnvelope,
  };
}
