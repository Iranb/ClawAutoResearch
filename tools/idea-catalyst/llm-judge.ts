import type { IdeaFragment } from "./ranking";

export type PairwiseVote = "a" | "b" | "tie";

export type PairwiseJudgment = {
  fragment_a: string;
  fragment_b: string;
  preferred: PairwiseVote;
  reasoning: string;
  dimensions: {
    interdisciplinary_novelty: PairwiseVote;
    interdisciplinary_usefulness: PairwiseVote;
    depth_of_integration: PairwiseVote;
  };
};

function normalizeVote(value: unknown): PairwiseVote {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "a" || normalized === "fragment_a" || normalized === "left") {
    return "a";
  }
  if (normalized === "b" || normalized === "fragment_b" || normalized === "right") {
    return "b";
  }
  return "tie";
}

function readStringRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function serializeFragment(label: string, fragment: IdeaFragment) {
  return [
    `${label}:`,
    `- fragment_id: ${fragment.fragment_id}`,
    `- title: ${fragment.title}`,
    `- source_domain: ${fragment.source_domain}`,
    `- novelty: ${fragment.novelty}`,
    `- feasibility: ${fragment.feasibility}`,
    `- relevance: ${fragment.relevance}`,
    `- clarity: ${fragment.clarity}`,
    `- interdisciplinary_potential: ${fragment.interdisciplinary_potential ?? "n/a"}`,
  ].join("\n");
}

export function buildPairwiseComparisonPrompt(params: {
  researchProblem: string;
  targetDomain: string;
  fragmentA: IdeaFragment;
  fragmentB: IdeaFragment;
}) {
  return `You are evaluating two IDEA-CATALYST fragments for interdisciplinary research design.

Research problem:
${params.researchProblem}

Target domain:
${params.targetDomain}

${serializeFragment("Fragment A", params.fragmentA)}

${serializeFragment("Fragment B", params.fragmentB)}

Judge the fragments along these dimensions:
- interdisciplinary_novelty
- interdisciplinary_usefulness
- depth_of_integration

In plain language, focus on which fragment shows deeper depth of integration into the target-domain problem, not just higher novelty.

Return strict JSON with this schema:
{
  "fragment_a": "${params.fragmentA.fragment_id}",
  "fragment_b": "${params.fragmentB.fragment_id}",
  "preferred": "a|b|tie",
  "reasoning": "short justification",
  "dimensions": {
    "interdisciplinary_novelty": "a|b|tie",
    "interdisciplinary_usefulness": "a|b|tie",
    "depth_of_integration": "a|b|tie"
  }
}`;
}

export function parsePairwiseJudgment(raw: string): PairwiseJudgment {
  const text = String(raw ?? "").trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = readStringRecord(JSON.parse(text));
  } catch {
    parsed = null;
  }

  if (!parsed) {
    const preferredMatch = text.match(/\bpreferred\b[^a-z0-9]+([ab]|tie)\b/i);
    const fragmentAMatch = text.match(/\bfragment[_\s-]*a\b[^a-z0-9]+([a-z0-9._:-]+)/i);
    const fragmentBMatch = text.match(/\bfragment[_\s-]*b\b[^a-z0-9]+([a-z0-9._:-]+)/i);
    return {
      fragment_a: fragmentAMatch?.[1] ?? "fragment-a",
      fragment_b: fragmentBMatch?.[1] ?? "fragment-b",
      preferred: normalizeVote(preferredMatch?.[1] ?? "tie"),
      reasoning: text || "No explicit reasoning provided.",
      dimensions: {
        interdisciplinary_novelty: "tie",
        interdisciplinary_usefulness: "tie",
        depth_of_integration: "tie",
      },
    };
  }

  const dimensions = readStringRecord(parsed.dimensions);
  return {
    fragment_a: String(parsed.fragment_a ?? parsed.fragmentA ?? "fragment-a"),
    fragment_b: String(parsed.fragment_b ?? parsed.fragmentB ?? "fragment-b"),
    preferred: normalizeVote(parsed.preferred),
    reasoning: String(parsed.reasoning ?? "No explicit reasoning provided."),
    dimensions: {
      interdisciplinary_novelty: normalizeVote(
        dimensions?.interdisciplinary_novelty ?? dimensions?.interdisciplinaryNovelty
      ),
      interdisciplinary_usefulness: normalizeVote(
        dimensions?.interdisciplinary_usefulness ??
          dimensions?.interdisciplinaryUsefulness
      ),
      depth_of_integration: normalizeVote(
        dimensions?.depth_of_integration ?? dimensions?.depthOfIntegration
      ),
    },
  };
}
