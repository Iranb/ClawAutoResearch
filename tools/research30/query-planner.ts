import { normalizeTitle } from "../paper-source-contract";
import {
  inferVenuePacksFromTopic,
  type VenueRegistryEntry,
} from "./venue-registry";
import type { BroadPaperSearchDepth, BroadPaperSearchQuery } from "./provider-contract";
import { sanitizeTopicForSearch } from "./topic-relevance";

type QueryFamily =
  | "direct"
  | "synonym"
  | "task_method"
  | "paragraph_semantic"
  | "venue_pack";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "using",
  "based",
  "approach",
  "method",
  "methods",
  "paper",
  "papers",
  "study",
  "research",
]);

function tokenizeQuery(value: string): string[] {
  return (normalizeTitle(value) ?? "")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function buildCondensedQuery(topic: string): string | null {
  const tokens = tokenizeQuery(topic);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, 8).join(" ");
}

function buildMethodTaskQuery(topic: string): string | null {
  const tokens = tokenizeQuery(topic);
  if (tokens.length < 3) {
    return null;
  }
  const prefix = tokens.slice(0, Math.min(5, tokens.length)).join(" ");
  return `${prefix} benchmark baseline`;
}

function buildSynonymVariant(topic: string): string | null {
  const normalized = normalizeTitle(topic);
  if (!normalized) {
    return null;
  }
  return normalized
    .replace(/\bllm\b/g, "large language model")
    .replace(/\bml\b/g, "machine learning")
    .replace(/\bcv\b/g, "computer vision")
    .replace(/\bnlp\b/g, "natural language processing")
    .replace(/\bgcd\b/g, "generalized category discovery");
}

function addQuery(
  entries: BroadPaperSearchQuery[],
  seen: Set<string>,
  params: {
    family: QueryFamily;
    query: string | null;
    rationale: string;
    venuePack?: string | null;
  }
) {
  const query = params.query?.trim();
  if (!query) {
    return;
  }
  const key = `${query.toLowerCase()}::${params.venuePack ?? ""}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  entries.push({
    id: `q${entries.length + 1}`,
    query,
    family: params.family,
    rationale: params.rationale,
    venuePack: params.venuePack ?? null,
  });
}

export function buildBroadPaperSearchPlan(params: {
  topic: string;
  depth?: BroadPaperSearchDepth;
  maxQueries?: number;
}): {
  topic: string;
  normalizedTopic: string | null;
  preferredVenuePacks: string[];
  queries: BroadPaperSearchQuery[];
} {
  const topic = params.topic.trim();
  const searchTopic = sanitizeTopicForSearch(topic) || topic;
  const normalizedTopic = normalizeTitle(searchTopic);
  const preferredVenuePacks = inferVenuePacksFromTopic(searchTopic || topic);
  const maxQueries =
    typeof params.maxQueries === "number" && Number.isFinite(params.maxQueries)
      ? Math.max(4, Math.min(12, Math.floor(params.maxQueries)))
      : params.depth === "deep"
        ? 10
        : 8;
  const queries: BroadPaperSearchQuery[] = [];
  const seen = new Set<string>();

  addQuery(queries, seen, {
    family: "direct",
    query: searchTopic,
    rationale: "Use the normalized core topic as the primary recall query.",
  });
  addQuery(queries, seen, {
    family: "paragraph_semantic",
    query: normalizedTopic,
    rationale: "Use normalized wording for semantic-friendly search providers.",
  });
  addQuery(queries, seen, {
    family: "synonym",
    query: buildSynonymVariant(searchTopic),
    rationale: "Expand common CS/AI abbreviations into canonical terminology.",
  });
  addQuery(queries, seen, {
    family: "task_method",
    query: buildMethodTaskQuery(searchTopic),
    rationale: "Backfill baseline and benchmark literature around the topic.",
  });
  addQuery(queries, seen, {
    family: "synonym",
    query: buildCondensedQuery(searchTopic),
    rationale: "Use a shorter condensed query for providers that degrade on long descriptions.",
  });
  for (const venuePack of preferredVenuePacks) {
    addQuery(queries, seen, {
      family: "venue_pack",
      query: `${buildCondensedQuery(searchTopic) ?? searchTopic} ${venuePack.replace(/_/g, " ")}`,
      rationale: "Bias recall toward likely top-tier venue families for the topic.",
      venuePack,
    });
    if (queries.length >= maxQueries) {
      break;
    }
  }

  return {
    topic,
    normalizedTopic,
    preferredVenuePacks,
    queries: queries.slice(0, maxQueries),
  };
}
