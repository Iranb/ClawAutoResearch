import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type LearnedStorylineModelFeatureVector = Record<string, number>;

export type LearnedStorylineModel = {
  schemaVersion: number;
  modelId: string;
  trainedAt: string;
  trainingExampleCount: number;
  epochs: number;
  strategyIds: string[];
  featureIds: string[];
  weights: Record<string, number>;
  bias: number;
  confidenceMarginThreshold: number;
  metadata: {
    sourceFixtures: string[];
    notes: string[];
  };
};

export const DEFAULT_LEARNED_STORYLINE_MODEL_FILENAME =
  "survey-storyline-learned-model.json";

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

function buildFingerprint(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

export function resolveBundledLearnedStorylineModelPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    DEFAULT_LEARNED_STORYLINE_MODEL_FILENAME
  );
}

export function scoreCandidateWithLearnedModel(params: {
  model: LearnedStorylineModel;
  featureVector: LearnedStorylineModelFeatureVector;
}): number {
  return Object.entries(params.model.weights).reduce((sum, [featureId, weight]) => {
    return sum + (params.featureVector[featureId] ?? 0) * weight;
  }, params.model.bias);
}

export function confidenceFromLearnedMargin(params: {
  margin: number;
  threshold: number;
}): number {
  if (!Number.isFinite(params.margin) || params.threshold <= 0) {
    return 0;
  }
  return Number(
    Math.max(0, Math.min(1, params.margin / params.threshold)).toFixed(4)
  );
}

export function trainLearnedStorylineModel(params: {
  examples: Array<{
    fixtureName: string;
    expectedStrategyId: string;
    candidateFeatureVectors: Array<{
      strategyId: string;
      featureVector: LearnedStorylineModelFeatureVector;
    }>;
  }>;
  epochs?: number;
}): LearnedStorylineModel {
  const epochs = Math.max(4, params.epochs ?? 12);
  const featureIds = uniqueStrings(
    params.examples.flatMap((example) =>
      example.candidateFeatureVectors.flatMap((entry) =>
        Object.keys(entry.featureVector)
      )
    )
  );
  const strategyIds = uniqueStrings(
    params.examples.flatMap((example) =>
      example.candidateFeatureVectors.map((entry) => entry.strategyId)
    )
  );
  const positiveSums = Object.fromEntries(featureIds.map((featureId) => [featureId, 0]));
  const negativeSums = Object.fromEntries(featureIds.map((featureId) => [featureId, 0]));
  let positiveCount = 0;
  let negativeCount = 0;
  for (const example of params.examples) {
    const expected = example.candidateFeatureVectors.find(
      (entry) => entry.strategyId === example.expectedStrategyId
    );
    if (!expected) {
      continue;
    }
    positiveCount += 1;
    for (const featureId of featureIds) {
      positiveSums[featureId] += expected.featureVector[featureId] ?? 0;
    }
    for (const candidate of example.candidateFeatureVectors) {
      if (candidate.strategyId === expected.strategyId) {
        continue;
      }
      negativeCount += 1;
      for (const featureId of featureIds) {
        negativeSums[featureId] += candidate.featureVector[featureId] ?? 0;
      }
    }
  }
  const weights = Object.fromEntries(
    featureIds.map((featureId) => {
      const positiveMean = positiveCount > 0 ? positiveSums[featureId] / positiveCount : 0;
      const negativeMean = negativeCount > 0 ? negativeSums[featureId] / negativeCount : 0;
      return [featureId, Number((positiveMean - negativeMean).toFixed(6))];
    })
  );
  const bias = 0;

  const margins = params.examples
    .map((example) => {
      const scored = example.candidateFeatureVectors
        .map((entry) => ({
          strategyId: entry.strategyId,
          score: scoreCandidateWithLearnedModel({
            model: {
              schemaVersion: 1,
              modelId: "trained",
              trainedAt: nowIso(),
              trainingExampleCount: params.examples.length,
              epochs,
              strategyIds,
              featureIds,
              weights,
              bias,
              confidenceMarginThreshold: 1,
              metadata: { sourceFixtures: [], notes: [] },
            },
            featureVector: entry.featureVector,
          }),
        }))
        .sort((left, right) => right.score - left.score);
      return scored.length >= 2
        ? Math.abs(scored[0].score - scored[1].score)
        : Math.abs(scored[0]?.score ?? 0);
    })
    .filter((value) => Number.isFinite(value));

  const averageMargin =
    margins.length > 0
      ? margins.reduce((sum, value) => sum + value, 0) / margins.length
      : 1;

  return {
    schemaVersion: 1,
    modelId: `survey-storyline-learned-${buildFingerprint({
      featureIds,
      weights,
      bias,
      strategies: strategyIds,
    }).slice(0, 12)}`,
    trainedAt: nowIso(),
    trainingExampleCount: params.examples.length,
    epochs,
    strategyIds,
    featureIds,
    weights,
    bias,
    confidenceMarginThreshold: Number(
      Math.max(0.25, averageMargin).toFixed(4)
    ),
    metadata: {
      sourceFixtures: uniqueStrings(params.examples.map((entry) => entry.fixtureName)),
      notes: [
        "Deterministic linear reranker trained from fixture labels via positive-vs-negative feature centroids.",
        "Use reviewer-judged planner as fallback when confidence stays below threshold.",
      ],
    },
  };
}

export async function readLearnedStorylineModel(
  explicitPath?: string | null
): Promise<LearnedStorylineModel | null> {
  const targetPath = explicitPath?.trim() || resolveBundledLearnedStorylineModelPath();
  try {
    const raw = JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
    const metadata =
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {};
    const weightsRecord =
      raw.weights && typeof raw.weights === "object" && !Array.isArray(raw.weights)
        ? (raw.weights as Record<string, unknown>)
        : {};
    const weights = Object.fromEntries(
      Object.entries(weightsRecord)
        .filter(([_featureId, value]) => typeof value === "number" && Number.isFinite(value))
        .map(([featureId, value]) => [featureId, value as number])
    );
    const featureIds = uniqueStrings(Object.keys(weights));
    if (featureIds.length === 0) {
      return null;
    }
    return {
      schemaVersion:
        typeof raw.schemaVersion === "number"
          ? Math.max(1, Math.floor(raw.schemaVersion))
          : typeof raw.schema_version === "number"
            ? Math.max(1, Math.floor(raw.schema_version))
            : 1,
      modelId:
        typeof raw.modelId === "string"
          ? raw.modelId
          : typeof raw.model_id === "string"
            ? raw.model_id
            : "survey-storyline-learned",
      trainedAt:
        typeof raw.trainedAt === "string"
          ? raw.trainedAt
          : typeof raw.trained_at === "string"
            ? raw.trained_at
            : nowIso(),
      trainingExampleCount:
        typeof raw.trainingExampleCount === "number"
          ? Math.max(0, Math.floor(raw.trainingExampleCount))
          : typeof raw.training_example_count === "number"
            ? Math.max(0, Math.floor(raw.training_example_count))
            : 0,
      epochs:
        typeof raw.epochs === "number" ? Math.max(1, Math.floor(raw.epochs)) : 1,
      strategyIds: uniqueStrings(
        Array.isArray(raw.strategyIds)
          ? raw.strategyIds.map((entry) => String(entry))
          : Array.isArray(raw.strategy_ids)
            ? raw.strategy_ids.map((entry) => String(entry))
            : []
      ),
      featureIds,
      weights,
      bias: typeof raw.bias === "number" && Number.isFinite(raw.bias) ? raw.bias : 0,
      confidenceMarginThreshold:
        typeof raw.confidenceMarginThreshold === "number" &&
        Number.isFinite(raw.confidenceMarginThreshold)
          ? raw.confidenceMarginThreshold
          : typeof raw.confidence_margin_threshold === "number" &&
              Number.isFinite(raw.confidence_margin_threshold)
            ? raw.confidence_margin_threshold
            : 1,
      metadata: {
        sourceFixtures: uniqueStrings(
          Array.isArray(metadata.sourceFixtures)
            ? metadata.sourceFixtures.map((entry: unknown) => String(entry))
            : Array.isArray(metadata.source_fixtures)
              ? metadata.source_fixtures.map((entry: unknown) => String(entry))
              : []
        ),
        notes: uniqueStrings(
          Array.isArray(metadata.notes)
            ? metadata.notes.map((entry: unknown) => String(entry))
            : []
        ),
      },
    };
  } catch {
    return null;
  }
}

export async function writeLearnedStorylineModel(params: {
  model: LearnedStorylineModel;
  explicitPath?: string | null;
}): Promise<string> {
  const targetPath = params.explicitPath?.trim() || resolveBundledLearnedStorylineModelPath();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `${JSON.stringify(
      {
        schema_version: params.model.schemaVersion,
        model_id: params.model.modelId,
        trained_at: params.model.trainedAt,
        training_example_count: params.model.trainingExampleCount,
        epochs: params.model.epochs,
        strategy_ids: params.model.strategyIds,
        feature_ids: params.model.featureIds,
        weights: params.model.weights,
        bias: params.model.bias,
        confidence_margin_threshold: params.model.confidenceMarginThreshold,
        metadata: {
          source_fixtures: params.model.metadata.sourceFixtures,
          notes: params.model.metadata.notes,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return targetPath;
}
