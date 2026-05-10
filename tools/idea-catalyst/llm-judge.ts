import type { IdeaFragment } from "./ranking";
import {
  getPromptLines,
  getPromptText,
  loadWorkflowPromptConfig,
  type WorkflowPromptConfig,
} from "../workflow-prompt-config";
import {
  getIdeaCatalystRankingCriteria,
  getIdeaCatalystRankingCriteriaDefinitions,
} from "./prompt-contracts";

export type PairwiseVote = "a" | "b" | "tie";

export type PairwiseJudgment = {
  fragment_a: string;
  fragment_b: string;
  preferred: PairwiseVote;
  reasoning: string;
  dimensions: {
    depth_of_integration: PairwiseVote;
    multi_stage_disciplinary_engagement: PairwiseVote;
    innovation_payoff: PairwiseVote;
    novelty_feasibility: PairwiseVote;
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

function briefValue(value: unknown, maxLength = 650) {
  if (value === null || value === undefined) {
    return "n/a";
  }
  const raw =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2) ?? String(value ?? "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function readIdeaString(fragment: IdeaFragment, keys: string[]) {
  const ideaRecord = readStringRecord(fragment.idea_fragment);
  for (const key of keys) {
    const fragmentValue = (fragment as unknown as Record<string, unknown>)[key];
    if (typeof fragmentValue === "string" && fragmentValue.trim()) {
      return fragmentValue.trim();
    }
    const ideaValue = ideaRecord?.[key];
    if (typeof ideaValue === "string" && ideaValue.trim()) {
      return ideaValue.trim();
    }
  }
  return null;
}

function readIdeaValue(fragment: IdeaFragment, key: keyof IdeaFragment) {
  const value = fragment[key];
  if (value !== null && value !== undefined) {
    return value;
  }
  return readStringRecord(fragment.idea_fragment)?.[key];
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function serializeFragment(label: string, fragment: IdeaFragment) {
  return [
    `${label}:`,
    `- fragment_id: ${fragment.fragment_id}`,
    `- title: ${fragment.title}`,
    `- source_domain: ${fragment.source_domain}`,
    `- target_domain: ${fragment.target_domain ?? "n/a"}`,
    `- transferred_mechanism: ${fragment.transferred_mechanism ?? "n/a"}`,
    `- core_insight: ${readIdeaString(fragment, ["core_insight", "coreInsight"]) ?? "n/a"}`,
    `- integration_mechanism: ${briefValue(readIdeaValue(fragment, "integration_mechanism"))}`,
    `- challenge_resolution: ${briefValue(readIdeaValue(fragment, "challenge_resolution"))}`,
    `- concrete_realization: ${briefValue(readIdeaValue(fragment, "concrete_realization"))}`,
    `- evidence_tier: ${fragment.evidence_tier ?? "n/a"}`,
    `- claim_cap: ${fragment.claim_cap ?? "n/a"}`,
    `- bridge_path_count: ${countArray(fragment.bridge_path_ids)}`,
    `- source_span_count: ${countArray(fragment.source_spans)}`,
    `- evidence_chain_ref_count: ${countArray(fragment.evidence_chain_refs)}`,
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
  promptConfig?: WorkflowPromptConfig | null;
}) {
  const criteria = getIdeaCatalystRankingCriteria();
  const criteriaDefinitions = getIdeaCatalystRankingCriteriaDefinitions();
  const config = params.promptConfig ?? loadWorkflowPromptConfig();
  const configRoot = ["ideaCatalyst", "pairwiseJudge"];
  const role = getPromptText(
    config,
    [...configRoot, "role"],
    "You are evaluating two IDEA-CATALYST fragments for interdisciplinary research design."
  );
  const decisionRules = getPromptLines(config, [...configRoot, "decisionRules"], [
    "Use the fragment text, integration mechanism, challenge resolution, and supporting evidence before considering numeric scores.",
    "Prefer the fragment that creates a non-obvious but credible target-source synthesis, not the one that is merely clearer or more immediately practical.",
    "Do not punish larger domain distance by itself; judge whether the distance creates useful conceptual leverage.",
    "Relevance alone is insufficient if the source-domain idea does not change the target-domain problem formulation.",
  ]);
  const outputRules = getPromptLines(config, [...configRoot, "outputRules"], [
    "Give concise reasons tied to the named dimensions.",
    "If both fragments are weak or equivalent on a dimension, mark that dimension as tie.",
    "Do not invent new fragment content or improve either proposal during judging.",
  ]);

  return `${role}

Research problem:
${params.researchProblem}

Target domain:
${params.targetDomain}

${serializeFragment("Fragment A", params.fragmentA)}

${serializeFragment("Fragment B", params.fragmentB)}

Judge the fragments along these dimensions:
${criteria.map((entry) => `- ${entry}`).join("\n")}

Dimension definitions:
${criteriaDefinitions.map((entry) => `- ${entry}`).join("\n")}

Decision rules:
${decisionRules.map((entry) => `- ${entry}`).join("\n")}

Output rules:
${outputRules.map((entry) => `- ${entry}`).join("\n")}

In plain language, focus on which fragment shows deeper target-domain integration, broader multi-stage disciplinary engagement, higher innovation payoff, and the stronger combined novelty + feasibility balance.

Return strict JSON with this schema:
{
  "fragment_a": "${params.fragmentA.fragment_id}",
  "fragment_b": "${params.fragmentB.fragment_id}",
  "preferred": "a|b|tie",
  "reasoning": "short justification",
  "dimensions": {
    "depth_of_integration": "a|b|tie",
    "multi_stage_disciplinary_engagement": "a|b|tie",
    "innovation_payoff": "a|b|tie",
    "novelty_feasibility": "a|b|tie"
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
        depth_of_integration: "tie",
        multi_stage_disciplinary_engagement: "tie",
        innovation_payoff: "tie",
        novelty_feasibility: "tie",
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
      depth_of_integration: normalizeVote(
        dimensions?.depth_of_integration ?? dimensions?.depthOfIntegration
      ),
      multi_stage_disciplinary_engagement: normalizeVote(
        dimensions?.multi_stage_disciplinary_engagement ??
          dimensions?.multiStageDisciplinaryEngagement
      ),
      innovation_payoff: normalizeVote(
        dimensions?.innovation_payoff ?? dimensions?.innovationPayoff
      ),
      novelty_feasibility: normalizeVote(
        dimensions?.novelty_feasibility ?? dimensions?.noveltyFeasibility
      ),
    },
  };
}
