import fixtures from "./relevance-reranker-fixtures.json" with { type: "json" };
import { scoreSemanticTopicRelevance } from "./semantic-relevance";

type FeatureVector = number[];

function dot(left: FeatureVector, right: FeatureVector): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function average(vectors: FeatureVector[]): FeatureVector {
  if (vectors.length === 0) {
    return [0, 0, 0, 0, 0];
  }
  const width = vectors[0].length;
  const result = new Array<number>(width).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < width; index += 1) {
      result[index] += vector[index] ?? 0;
    }
  }
  return result.map((value) => value / vectors.length);
}

function featureize(params: {
  topic: string;
  title: string | null | undefined;
  abstract?: string | null | undefined;
  bodyText?: string | null | undefined;
}): FeatureVector {
  const semantic = scoreSemanticTopicRelevance(params);
  return [
    semantic.lexicalScore / 100,
    semantic.rerankScore / 100,
    semantic.titleSimilarity,
    semantic.bodySimilarity,
    semantic.topicCoverage,
  ];
}

function trainFixtureModel() {
  const positives = fixtures.items
    .filter((entry) => entry.label === "positive")
    .map((entry) => featureize(entry));
  const negatives = fixtures.items
    .filter((entry) => entry.label === "negative")
    .map((entry) => featureize(entry));
  return {
    modelVersion: fixtures.modelVersion,
    positiveCentroid: average(positives),
    negativeCentroid: average(negatives),
  };
}

const MODEL = trainFixtureModel();

export function scoreLearnedTopicRelevance(params: {
  topic: string;
  title: string | null | undefined;
  abstract?: string | null | undefined;
  bodyText?: string | null | undefined;
}) {
  const vector = featureize(params);
  const positive = dot(vector, MODEL.positiveCentroid);
  const negative = dot(vector, MODEL.negativeCentroid);
  const margin = positive - negative;
  const score = Math.max(0, Math.min(100, 50 + margin * 45));
  return {
    modelVersion: MODEL.modelVersion,
    score,
    margin,
  };
}
