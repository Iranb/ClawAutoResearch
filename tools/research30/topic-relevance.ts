import { normalizeTitle } from "../paper-source-contract";

const TOPIC_NOISE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "baseline",
  "baselines",
  "benchmark",
  "benchmarks",
  "citation",
  "citations",
  "cites",
  "core",
  "dataset",
  "datasets",
  "deep",
  "extensions",
  "follow",
  "framework",
  "frameworks",
  "general",
  "latest",
  "literature",
  "method",
  "methods",
  "metric",
  "metrics",
  "model",
  "models",
  "paper",
  "papers",
  "project",
  "projects",
  "recent",
  "review",
  "reviews",
  "scope",
  "search",
  "study",
  "studies",
  "survey",
  "surveys",
  "task",
  "tasks",
  "topic",
  "topics",
  "up",
  "version",
  "workflow",
]);

const ACRONYM_EXPANSIONS = new Map<string, string[]>([
  ["gcd", ["generalized", "category", "discovery"]],
  ["ncd", ["novel", "class", "discovery"]],
  ["owr", ["open", "world", "recognition"]],
  ["osr", ["open", "set", "recognition"]],
  ["gzsl", ["generalized", "zero", "shot", "learning"]],
  ["fg", ["fine", "grained"]],
  ["llm", ["large", "language", "model"]],
  ["vlm", ["vision", "language", "model"]],
]);

function isMostlyNumericToken(token: string): boolean {
  return /^\d+$/.test(token) || /\d{3,}/.test(token);
}

function isNoiseToken(token: string): boolean {
  return (
    token.length < 2 ||
    /^v\d+$/i.test(token) ||
    /^(19|20)\d{2}$/.test(token) ||
    TOPIC_NOISE_TOKENS.has(token) ||
    isMostlyNumericToken(token)
  );
}

function expandTopicTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const expansion = ACRONYM_EXPANSIONS.get(token);
    if (expansion) {
      expanded.push(...expansion);
      continue;
    }
    expanded.push(token);
  }
  return expanded;
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const token of tokens) {
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    ordered.push(token);
  }
  return ordered;
}

function buildTopicPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  for (let size = Math.min(3, tokens.length); size >= 2; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(" ").trim();
      if (phrase.length > 0) {
        phrases.push(phrase);
      }
    }
  }
  return uniqueTokens(phrases);
}

export function buildSearchTopicTokens(topic: string): string[] {
  const normalizedTopic = normalizeTitle(topic) ?? "";
  const rawTokens = normalizedTopic
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
  const expandedTokens = expandTopicTokens(rawTokens);
  return uniqueTokens(expandedTokens.filter((token) => !isNoiseToken(token)));
}

export function sanitizeTopicForSearch(topic: string): string {
  const tokens = buildSearchTopicTokens(topic);
  if (tokens.length === 0) {
    return (normalizeTitle(topic) ?? topic).trim();
  }
  return tokens.slice(0, 12).join(" ");
}

export function scorePaperTopicRelevance(params: {
  topic: string;
  title: string | null | undefined;
  abstract?: string | null | undefined;
}): {
  score: number;
  normalizedTopic: string | null;
  matchedTokens: string[];
  matchedPhrases: string[];
} {
  const topicTokens = buildSearchTopicTokens(params.topic);
  const normalizedTopic = topicTokens.length > 0 ? topicTokens.join(" ") : null;
  const candidateText = normalizeTitle(
    [params.title, params.abstract].filter(Boolean).join(" ")
  );
  if (!candidateText || topicTokens.length === 0) {
    return {
      score: 0,
      normalizedTopic,
      matchedTokens: [],
      matchedPhrases: [],
    };
  }

  const candidateTokens = new Set(candidateText.split(" ").filter(Boolean));
  const matchedTokens = topicTokens.filter((token) => candidateTokens.has(token));
  if (matchedTokens.length === 0) {
    return {
      score: 0,
      normalizedTopic,
      matchedTokens: [],
      matchedPhrases: [],
    };
  }

  let score = 0;
  for (const token of matchedTokens) {
    score += Math.min(14, 5 + Math.floor(token.length / 2));
  }

  const matchedPhrases = buildTopicPhrases(topicTokens).filter((phrase) =>
    candidateText.includes(phrase)
  );
  for (const phrase of matchedPhrases) {
    score += phrase.split(" ").length >= 3 ? 26 : 18;
  }

  if (normalizedTopic && topicTokens.length >= 2 && candidateText.includes(normalizedTopic)) {
    score += 34;
  }

  if (matchedTokens.length >= Math.min(3, topicTokens.length)) {
    score += 10;
  }

  return {
    score: Math.min(100, score),
    normalizedTopic,
    matchedTokens,
    matchedPhrases,
  };
}
