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
  bodyText?: string | null | undefined;
}): {
  score: number;
  normalizedTopic: string | null;
  matchedTokens: string[];
  matchedPhrases: string[];
  evidenceSource: "missing" | "title" | "title_abstract" | "full_text";
} {
  const topicTokens = buildSearchTopicTokens(params.topic);
  const normalizedTopic = topicTokens.length > 0 ? topicTokens.join(" ") : null;
  const titleText = normalizeTitle(params.title);
  const abstractText = normalizeTitle(params.abstract);
  const bodyText = normalizeTitle(params.bodyText);
  const weightedParts = [
    titleText ? { text: titleText, tokenWeight: 12, bigramWeight: 20, trigramWeight: 30 } : null,
    abstractText
      ? { text: abstractText, tokenWeight: 7, bigramWeight: 12, trigramWeight: 18 }
      : null,
    bodyText ? { text: bodyText, tokenWeight: 4, bigramWeight: 9, trigramWeight: 14 } : null,
  ].filter(
    (
      part
    ): part is { text: string; tokenWeight: number; bigramWeight: number; trigramWeight: number } =>
      Boolean(part)
  );
  const candidateText = normalizeTitle(
    [params.title, params.abstract, params.bodyText].filter(Boolean).join(" ")
  );
  if (!candidateText || topicTokens.length === 0 || weightedParts.length === 0) {
    return {
      score: 0,
      normalizedTopic,
      matchedTokens: [],
      matchedPhrases: [],
      evidenceSource: "missing",
    };
  }

  const matchedTokenSet = new Set<string>();
  const matchedPhraseSet = new Set<string>();
  let score = 0;
  for (const part of weightedParts) {
    const partTokens = new Set(part.text.split(" ").filter(Boolean));
    for (const token of topicTokens) {
      if (partTokens.has(token)) {
        matchedTokenSet.add(token);
        score += Math.min(part.tokenWeight + 4, part.tokenWeight + Math.floor(token.length / 3));
      }
    }
    for (const phrase of buildTopicPhrases(topicTokens)) {
      if (part.text.includes(phrase)) {
        matchedPhraseSet.add(phrase);
        score += phrase.split(" ").length >= 3 ? part.trigramWeight : part.bigramWeight;
      }
    }
    if (normalizedTopic && topicTokens.length >= 2 && part.text.includes(normalizedTopic)) {
      score += part === weightedParts[0] ? 36 : part === weightedParts[1] ? 28 : 24;
    }
  }
  const matchedTokens = [...matchedTokenSet];
  const matchedPhrases = [...matchedPhraseSet];
  if (matchedTokens.length === 0 && matchedPhrases.length === 0) {
    return {
      score: 0,
      normalizedTopic,
      matchedTokens: [],
      matchedPhrases: [],
      evidenceSource: "missing",
    };
  }

  if (matchedTokens.length >= Math.min(3, topicTokens.length)) {
    score += 10;
  }
  if (bodyText) {
    const repetitionCount = matchedTokens.reduce(
      (sum, token) => sum + (bodyText.match(new RegExp(`\\b${token}\\b`, "g"))?.length ?? 0),
      0
    );
    if (repetitionCount >= Math.max(3, matchedTokens.length + 1)) {
      score += 10;
    }
  }
  const evidenceSource: "missing" | "title" | "title_abstract" | "full_text" = bodyText
    ? "full_text"
    : abstractText
      ? "title_abstract"
      : titleText
        ? "title"
        : "missing";

  return {
    score: Math.min(100, score),
    normalizedTopic,
    matchedTokens,
    matchedPhrases,
    evidenceSource,
  };
}
