import { buildSearchTopicTokens, scorePaperTopicRelevance } from "./topic-relevance";

type SparseVector = Map<string, number>;

const SEMANTIC_ALIAS_GROUPS = [
  ["generalized", "open_world", "openworld", "open_set", "unseen", "novel"],
  ["category", "class", "label", "concept"],
  ["discovery", "clustering", "grouping", "mining", "recognition"],
  ["benchmark", "dataset", "evaluation", "protocol", "metric"],
  ["robustness", "shift", "domain_shift", "distribution_shift", "transfer"],
] as const;

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildAliasMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of SEMANTIC_ALIAS_GROUPS) {
    const values = [...group];
    for (const term of values) {
      map.set(term, values.filter((value) => value !== term));
    }
  }
  return map;
}

const ALIAS_MAP = buildAliasMap();

function expandSemanticTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const aliases = ALIAS_MAP.get(token) ?? [];
    expanded.push(...aliases);
  }
  return uniqueStrings(expanded);
}

function buildFieldTokens(text: string): string[] {
  return uniqueStrings(
    normalizeText(text)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function buildTextNgrams(tokens: string[], size: number): string[] {
  if (tokens.length < size) {
    return [];
  }
  const values: string[] = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    values.push(tokens.slice(index, index + size).join("_"));
  }
  return values;
}

function addWeight(vector: SparseVector, key: string, weight: number) {
  if (!key || !Number.isFinite(weight) || weight === 0) {
    return;
  }
  vector.set(key, (vector.get(key) ?? 0) + weight);
}

function buildSparseEmbedding(text: string, fieldWeight: number): SparseVector {
  const vector: SparseVector = new Map();
  const tokens = buildFieldTokens(text);
  for (const token of tokens) {
    addWeight(vector, `tok:${token}`, fieldWeight);
  }
  for (const token of expandSemanticTokens(tokens)) {
    addWeight(vector, `sem:${token}`, fieldWeight * 0.8);
  }
  for (const bigram of buildTextNgrams(tokens, 2)) {
    addWeight(vector, `bi:${bigram}`, fieldWeight * 1.2);
  }
  for (const trigram of buildTextNgrams(tokens, 3)) {
    addWeight(vector, `tri:${trigram}`, fieldWeight * 1.4);
  }
  const collapsed = normalizeText(text).replace(/\s+/g, "");
  for (let index = 0; index <= collapsed.length - 4; index += 1) {
    addWeight(vector, `char4:${collapsed.slice(index, index + 4)}`, fieldWeight * 0.35);
  }
  return vector;
}

function mergeVectors(vectors: Array<{ vector: SparseVector; weight: number }>): SparseVector {
  const merged: SparseVector = new Map();
  for (const { vector, weight } of vectors) {
    for (const [key, value] of vector.entries()) {
      addWeight(merged, key, value * weight);
    }
  }
  return merged;
}

function cosineSimilarity(left: SparseVector, right: SparseVector): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const [key, value] of smaller.entries()) {
    dot += value * (larger.get(key) ?? 0);
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export type SemanticTopicRelevance = {
  rerankScore: number;
  lexicalScore: number;
  titleSimilarity: number;
  abstractSimilarity: number;
  bodySimilarity: number;
  topicCoverage: number;
};

export function scoreSemanticTopicRelevance(params: {
  topic: string;
  title: string | null | undefined;
  abstract?: string | null | undefined;
  bodyText?: string | null | undefined;
}): SemanticTopicRelevance {
  const lexical = scorePaperTopicRelevance({
    topic: params.topic,
    title: params.title,
    abstract: params.abstract,
    bodyText: params.bodyText,
  });
  const topicTokens = expandSemanticTokens(buildSearchTopicTokens(params.topic));
  const topicVector = buildSparseEmbedding(topicTokens.join(" "), 1.5);
  const titleVector = buildSparseEmbedding(params.title ?? "", 1.2);
  const abstractVector = buildSparseEmbedding(params.abstract ?? "", 1);
  const bodyVector = buildSparseEmbedding(params.bodyText ?? "", 0.9);
  const mergedCandidate = mergeVectors([
    { vector: titleVector, weight: 1.4 },
    { vector: abstractVector, weight: 1.2 },
    { vector: bodyVector, weight: 1 },
  ]);
  const titleSimilarity = cosineSimilarity(topicVector, titleVector);
  const abstractSimilarity = cosineSimilarity(topicVector, abstractVector);
  const bodySimilarity = cosineSimilarity(topicVector, bodyVector);
  const overallSimilarity = cosineSimilarity(topicVector, mergedCandidate);
  const candidateTokens = uniqueStrings([
    ...buildFieldTokens(params.title ?? ""),
    ...buildFieldTokens(params.abstract ?? ""),
    ...buildFieldTokens(params.bodyText ?? ""),
  ]);
  const topicCoverage =
    topicTokens.length > 0
      ? topicTokens.filter((token) => candidateTokens.includes(token)).length / topicTokens.length
      : 0;
  const rerankScore = Math.min(
    100,
    lexical.score * 0.45 +
      titleSimilarity * 28 +
      abstractSimilarity * 36 +
      bodySimilarity * 44 +
      overallSimilarity * 30 +
      topicCoverage * 25 +
      (params.bodyText && bodySimilarity >= 0.2 && topicCoverage >= 0.5 ? 12 : 0)
  );
  return {
    rerankScore,
    lexicalScore: lexical.score,
    titleSimilarity,
    abstractSimilarity,
    bodySimilarity,
    topicCoverage,
  };
}
