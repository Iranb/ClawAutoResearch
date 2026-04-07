import * as path from "node:path";
import { readJsonIfExists, writeTextEnsured } from "../workflow-guard-core/fs";

export const DEFAULT_VENUE_ROUTING_PLAN_PATH = "academic_writer/VENUE_ROUTING_PLAN.md";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const results: string[] = [];
  for (const entry of value) {
    const normalized = asString(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function quote(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value.trim() : "unset";
}

export type VenueArgumentStyle = {
  venue: string;
  style: "theorem-first" | "reproducibility-first" | "impact-first" | "linguistic-depth" | "general";
  keyEmphases: string[];
};

function deriveArgumentStyle(venue: string): VenueArgumentStyle {
  const normalized = venue.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/neurips|nips|icml/.test(normalized)) {
    return {
      venue,
      style: "theorem-first",
      keyEmphases: [
        "Lead with theoretical grounding or formal guarantees",
        "Follow with empirical validation on standard benchmarks",
        "Highlight computational complexity and scalability analysis",
        "Include ablation studies isolating each contribution",
      ],
    };
  }
  if (/iclr/.test(normalized)) {
    return {
      venue,
      style: "reproducibility-first",
      keyEmphases: [
        "Emphasize reproducibility: code, hyperparameters, random seeds",
        "Frame for open-review: anticipate reviewer questions in text",
        "Lead with clear problem statement and motivation",
        "Include reproducibility checklist compliance",
      ],
    };
  }
  if (/kdd/.test(normalized)) {
    return {
      venue,
      style: "impact-first",
      keyEmphases: [
        "Lead with real-world application impact and deployment considerations",
        "Demonstrate scalability with production-scale experiments",
        "Include case studies or industry validation where possible",
        "Address data pipeline and engineering aspects",
      ],
    };
  }
  if (/acl|emnlp|naacl|eacl|coling/.test(normalized)) {
    return {
      venue,
      style: "linguistic-depth",
      keyEmphases: [
        "Include thorough linguistic analysis and error analysis",
        "Human evaluation required alongside automatic metrics",
        "Cross-lingual or multi-lingual evaluation where applicable",
        "Discuss ethical implications and limitations explicitly",
      ],
    };
  }
  return {
    venue,
    style: "general",
    keyEmphases: [
      "Balance theoretical motivation with empirical evidence",
      "Include comprehensive ablation studies",
      "Address limitations and future work",
    ],
  };
}

function scoreVenue(params: {
  venue: string;
  targetVenues: string[];
  preferredVenues: string[];
  paperStoryState: {
    claimSupportStatus: string;
    supportedClaimCount: number;
    partialClaimCount: number;
    unsupportedClaimCount: number;
  };
  reviewPressureState: { status: string } | null;
}): { score: number; rationale: string[]; argumentStyle: VenueArgumentStyle } {
  const venue = params.venue;
  let score = 0;
  const rationale: string[] = [];
  if (params.targetVenues.some((entry) => entry.toLowerCase() === venue.toLowerCase())) {
    score += 4;
    rationale.push("Explicitly requested in target_venues.");
  }
  if (params.preferredVenues.some((entry) => entry.toLowerCase() === venue.toLowerCase())) {
    score += 2;
    rationale.push("Preferred by idle-research venue sweep configuration.");
  }
  if (/arxiv/i.test(venue)) {
    score += params.paperStoryState.claimSupportStatus === "supported" ? 1 : 3;
    rationale.push("Safer fallback venue when support is still evolving.");
  } else if (params.paperStoryState.claimSupportStatus === "supported") {
    score += 3;
    rationale.push("Current claim support is strong enough for venue-facing prose.");
  } else if (params.paperStoryState.claimSupportStatus === "partial") {
    score += 1;
    rationale.push("Partial support suggests conservative venue positioning.");
  } else {
    score -= 1;
    rationale.push("Unsupported claims make top-tier routing risky.");
  }
  if ((params.paperStoryState.unsupportedClaimCount ?? 0) > 0 && !/arxiv|workshop/i.test(venue)) {
    score -= 2;
    rationale.push("Unsupported claims still exist, so reviewer pressure remains high.");
  }
  if (params.reviewPressureState?.status === "ready" && /arxiv/i.test(venue)) {
    score += 1;
    rationale.push("Review pressure packet recommends a narrower, lower-risk submission envelope.");
  }
  return { score, rationale, argumentStyle: deriveArgumentStyle(venue) };
}

export async function materializeVenueRoutingPlan(params: {
  projectRoot: string;
  paperStoryState: {
    claimSupportStatus: string;
    supportedClaimCount: number;
    partialClaimCount: number;
    unsupportedClaimCount: number;
  };
  reviewPressureState: { status: string } | null;
  artifactPath?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
    {};
  const researchProgram = asRecord(manifest.research_program) ?? {};
  const idleResearch = asRecord(manifest.idle_research) ?? {};
  const targetVenues = asStringArray(manifest.target_venues);
  const preferredVenues = asStringArray(
    idleResearch.preferred_venues ?? idleResearch.preferredVenues
  );
  const venueCandidates = Array.from(
    new Set([...targetVenues, ...preferredVenues, "arXiv"])
  ).filter(Boolean);
  const scored = venueCandidates
    .map((venue) => ({
      venue,
      ...scoreVenue({
        venue,
        targetVenues,
        preferredVenues,
        paperStoryState: params.paperStoryState,
        reviewPressureState: params.reviewPressureState,
      }),
    }))
    .sort((left, right) => right.score - left.score || left.venue.localeCompare(right.venue));

  const recommendedVenue = scored[0]?.venue ?? "arXiv";
  const routeMode =
    params.paperStoryState.claimSupportStatus === "supported" &&
    (params.paperStoryState.unsupportedClaimCount ?? 0) === 0
      ? "venue_facing"
      : "risk_limited";
  const payload = `# Venue Routing Plan

## Recommendation

- Recommended venue: ${recommendedVenue}
- Route mode: ${routeMode}
- Goal: ${quote(asString(researchProgram.goal))}
- Primary metric: ${quote(asString(researchProgram.primary_metric ?? researchProgram.primaryMetric))}
- Baseline reference: ${quote(asString(researchProgram.baseline_reference ?? researchProgram.baselineReference))}

## Candidate ranking

${scored
  .map(
    (entry, index) =>
      `${index + 1}. ${entry.venue} (score=${entry.score})\n   - ${entry.rationale.join("\n   - ")}`
  )
  .join("\n\n")}

## Routing rules

- Prefer venue-facing prose only when unsupported claims are zero and the support status is \`${params.paperStoryState.claimSupportStatus}\`.
- If novelty or support pressure remains high, default to a narrower framing or arXiv-first route.
- Keep the paper scope aligned with the baseline and primary metric instead of broadening toward an aspirational venue.
`;

  const artifactPath = params.artifactPath ?? DEFAULT_VENUE_ROUTING_PLAN_PATH;
  const resolvedPath = path.join(projectRoot, artifactPath);
  await writeTextEnsured(resolvedPath, payload);
  return {
    path: artifactPath,
    recommendedVenue,
    routeMode,
    venueScores: scored,
  };
}

// ---------------------------------------------------------------------------
// Venue argument style materializer
// ---------------------------------------------------------------------------

export async function materializeVenueArgumentStyle(params: {
  projectRoot: string;
  recommendedVenue: string;
  artifactPath?: string | null;
}): Promise<{ path: string; content: string }> {
  const style = deriveArgumentStyle(params.recommendedVenue);
  const content = `# Venue Argument Style Guide

**Target Venue:** ${style.venue}
**Argument Style:** ${style.style}

## Key Emphases

${style.keyEmphases.map((e, i) => `${i + 1}. ${e}`).join("\n")}

## Writing Instructions

${style.style === "theorem-first" ? `- Structure: Theorem/Proposition → Proof sketch → Empirical validation
- Introduction must state the theoretical contribution before discussing experiments
- Related work should position against both theoretical and empirical baselines` : ""}${style.style === "reproducibility-first" ? `- Structure: Problem → Method → Reproducibility details → Results
- Include a reproducibility checklist as an appendix
- Hyperparameters, seeds, and compute budget must be explicit in the main text
- Anticipate open-review feedback in the writing` : ""}${style.style === "impact-first" ? `- Structure: Real-world problem → Proposed solution → Scale evidence → Impact analysis
- Lead the abstract with the application domain and impact metric
- Include deployment considerations and computational cost analysis` : ""}${style.style === "linguistic-depth" ? `- Structure: Linguistic phenomenon → Method → Automatic + Human evaluation → Error analysis
- Human evaluation methodology must be detailed (annotator agreement, guidelines)
- Include cross-lingual experiments or justify single-language scope
- Ethics statement required` : ""}${style.style === "general" ? `- Structure: Motivation → Method → Experiments → Analysis
- Balance theoretical and empirical contributions
- Include thorough ablation studies` : ""}
`;

  const artifactPath = params.artifactPath ?? "academic_writer/VENUE_ARGUMENT_STYLE.md";
  const resolvedPath = path.join(path.resolve(params.projectRoot), artifactPath);
  await writeTextEnsured(resolvedPath, content);
  return { path: artifactPath, content };
}
