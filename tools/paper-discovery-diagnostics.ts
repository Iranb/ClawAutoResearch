import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured, writeTextEnsured } from "./workflow-guard-core/fs";
import { asString } from "./workflow-guard-core/coercion";
import {
  readWorkflowPaperSourceIndex,
  type WorkflowPaperSourceEntry,
} from "./paper-source-index";

export type LiteratureCoverageVerdict = "thin" | "adequate" | "strong";

export type LiteratureCoverageAudit = {
  projectId: string | null;
  generatedAt: string;
  auditPath: string;
  markdownPath: string;
  verdict: LiteratureCoverageVerdict;
  totalPapers: number;
  recentPaperCount: number;
  metadataGaps: {
    missingCanonicalId: number;
    missingYear: number;
    missingVenue: number;
    missingSourcePath: number;
  };
  providerCoverage: Record<string, number>;
  venueCoverage: Record<string, number>;
  yearCoverage: Record<string, number>;
  baselineHints: string[];
  baselineMatches: Array<{
    hint: string;
    canonicalIds: string[];
    titles: string[];
  }>;
  missingBaselineHints: string[];
  recommendations: string[];
};

export type CitationExpansionPacket = {
  projectId: string | null;
  generatedAt: string;
  packetPath: string;
  markdownPath: string;
  bounded: true;
  maxSeeds: number;
  seeds: Array<{
    canonicalId: string | null;
    title: string | null;
    reason: string;
  }>;
  queries: Array<{
    type: "forward_citations" | "backward_references" | "keyword_refresh";
    seedCanonicalId: string | null;
    seedTitle: string | null;
    query: string;
    rationale: string;
  }>;
  recommendations: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => asString(value)).filter(Boolean))] as string[];
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

function readBaselineHints(manifest: Record<string, unknown>): string[] {
  const researchProgram = asRecord(manifest.research_program) ?? {};
  return uniqueStrings([
    asString(researchProgram.baseline_reference ?? researchProgram.baselineReference),
    ...((Array.isArray(researchProgram.required_baselines)
      ? researchProgram.required_baselines
      : Array.isArray(researchProgram.requiredBaselines)
        ? researchProgram.requiredBaselines
        : []) as unknown[]).map((entry) => asString(entry)),
  ]);
}

function countBy<T extends string>(values: Array<T | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = asString(value);
    if (!key) {
      continue;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function selectCitationSeeds(entries: WorkflowPaperSourceEntry[], maxSeeds: number) {
  const sorted = [...entries].sort((left, right) => {
    const rightCitation = right.citationCount ?? -1;
    const leftCitation = left.citationCount ?? -1;
    if (rightCitation !== leftCitation) {
      return rightCitation - leftCitation;
    }
    const rightYear = right.year ?? -1;
    const leftYear = left.year ?? -1;
    return rightYear - leftYear;
  });
  return sorted
    .filter((entry) => entry.title || entry.canonicalId)
    .slice(0, Math.max(1, maxSeeds));
}

function buildCoverageMarkdown(audit: LiteratureCoverageAudit): string {
  const lines = [
    "# Literature Coverage Audit",
    "",
    `- Generated at: ${audit.generatedAt}`,
    `- Verdict: ${audit.verdict}`,
    `- Total papers: ${audit.totalPapers}`,
    `- Recent papers (last 2 years): ${audit.recentPaperCount}`,
    `- Missing baseline hints: ${audit.missingBaselineHints.join(", ") || "none"}`,
    "",
    "## Recommendations",
    ...audit.recommendations.map((entry) => `- ${entry}`),
  ];
  return `${lines.join("\n")}\n`;
}

function buildCitationExpansionMarkdown(packet: CitationExpansionPacket): string {
  const lines = [
    "# Citation Expansion Packet",
    "",
    `- Generated at: ${packet.generatedAt}`,
    `- Max seeds: ${packet.maxSeeds}`,
    "",
    "## Seeds",
    ...packet.seeds.map((seed) => `- ${seed.title ?? seed.canonicalId ?? "unknown"}: ${seed.reason}`),
    "",
    "## Queries",
    ...packet.queries.map(
      (query) => `- [${query.type}] ${query.seedTitle ?? query.seedCanonicalId ?? "unknown"} -> ${query.query}`
    ),
    "",
    "## Recommendations",
    ...packet.recommendations.map((entry) => `- ${entry}`),
  ];
  return `${lines.join("\n")}\n`;
}

export async function auditLiteratureCoverage(params: {
  projectRoot: string;
}): Promise<LiteratureCoverageAudit> {
  const generatedAt = new Date().toISOString();
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId = asString(manifest.project_id ?? manifest.projectId) ?? null;
  const { entries } = await readWorkflowPaperSourceIndex({
    projectRoot: params.projectRoot,
  });
  const currentYear = new Date(generatedAt).getUTCFullYear();
  const recentPaperCount = entries.filter(
    (entry) => typeof entry.year === "number" && entry.year >= currentYear - 1
  ).length;
  const baselineHints = readBaselineHints(manifest);
  const baselineMatches = baselineHints.map((hint) => {
    const normalizedHint = normalizeTitle(hint);
    const matches = entries.filter((entry) => {
      const normalizedTitle = normalizeTitle(entry.title);
      return Boolean(normalizedHint && normalizedTitle && normalizedTitle.includes(normalizedHint));
    });
    return {
      hint,
      canonicalIds: uniqueStrings(matches.map((entry) => entry.canonicalId)),
      titles: uniqueStrings(matches.map((entry) => entry.title)),
    };
  });
  const missingBaselineHints = baselineMatches
    .filter((entry) => entry.canonicalIds.length === 0 && entry.titles.length === 0)
    .map((entry) => entry.hint);
  const recommendations: string[] = [];
  if (entries.length < 8) {
    recommendations.push(
      "Paper set is still thin; expand discovery before trusting frontier or survey synthesis."
    );
  }
  if (recentPaperCount < 3) {
    recommendations.push(
      "Recent-paper coverage is weak; add a bounded refresh focused on the last two years."
    );
  }
  if (missingBaselineHints.length > 0) {
    recommendations.push(
      `Baseline hints still missing from PAPER_SOURCE_INDEX.json: ${missingBaselineHints.join(", ")}.`
    );
  }
  if (Object.keys(countBy(entries.map((entry) => entry.sourceProvider))).length < 2) {
    recommendations.push(
      "Discovery sources are concentrated; consider mixing papers.cool with PASA or manual venue sweeps."
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Coverage looks stable enough for graph refresh; keep diagnostics non-blocking and refresh only if the topic shifts."
    );
  }
  const verdict: LiteratureCoverageVerdict =
    entries.length < 8 || missingBaselineHints.length > 0
      ? "thin"
      : recentPaperCount < 3
        ? "adequate"
        : "strong";
  const auditPath = path.join(params.projectRoot, "researcher", "LITERATURE_COVERAGE_AUDIT.json");
  const markdownPath = path.join(
    params.projectRoot,
    "researcher",
    "LITERATURE_COVERAGE_AUDIT.md"
  );
  const audit: LiteratureCoverageAudit = {
    projectId,
    generatedAt,
    auditPath,
    markdownPath,
    verdict,
    totalPapers: entries.length,
    recentPaperCount,
    metadataGaps: {
      missingCanonicalId: entries.filter((entry) => !entry.canonicalId).length,
      missingYear: entries.filter((entry) => entry.year == null).length,
      missingVenue: entries.filter((entry) => !entry.venue).length,
      missingSourcePath: entries.filter((entry) => !entry.sourcePath).length,
    },
    providerCoverage: countBy(entries.map((entry) => entry.sourceProvider)),
    venueCoverage: countBy(entries.map((entry) => entry.venue)),
    yearCoverage: countBy(entries.map((entry) => (entry.year != null ? String(entry.year) : null))),
    baselineHints,
    baselineMatches,
    missingBaselineHints,
    recommendations,
  };
  await writeJsonEnsured(auditPath, audit);
  await writeTextEnsured(markdownPath, buildCoverageMarkdown(audit));
  return audit;
}

export async function planCitationExpansion(params: {
  projectRoot: string;
  maxSeeds?: number | null;
}): Promise<CitationExpansionPacket> {
  const generatedAt = new Date().toISOString();
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId = asString(manifest.project_id ?? manifest.projectId) ?? null;
  const { entries } = await readWorkflowPaperSourceIndex({
    projectRoot: params.projectRoot,
  });
  const maxSeeds = Math.max(1, Math.min(8, Math.floor(params.maxSeeds ?? 4)));
  const seeds = selectCitationSeeds(entries, maxSeeds);
  const packetPath = path.join(params.projectRoot, "researcher", "CITATION_EXPANSION_PACKET.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "CITATION_EXPANSION_PACKET.md");
  const queries = seeds.flatMap((seed) => {
    const label = seed.title ?? seed.canonicalId ?? "unknown paper";
    return [
      {
        type: "backward_references" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Find core references and baseline ancestors for "${label}"`,
        rationale: "Backfill foundational baselines and direct predecessors.",
      },
      {
        type: "forward_citations" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Find recent follow-up papers that cite "${label}"`,
        rationale: "Refresh recent SOTA and successor work without broad uncontrolled search.",
      },
    ];
  });
  const packet: CitationExpansionPacket = {
    projectId,
    generatedAt,
    packetPath,
    markdownPath,
    bounded: true,
    maxSeeds,
    seeds: seeds.map((seed) => ({
      canonicalId: seed.canonicalId,
      title: seed.title,
      reason:
        seed.citationCount != null
          ? `High-value seed with citation_count=${seed.citationCount}.`
          : "Representative in-corpus seed for bounded expansion.",
    })),
    queries: [
      ...queries,
      {
        type: "keyword_refresh",
        seedCanonicalId: null,
        seedTitle: null,
        query: `Refresh missing recent papers for ${projectId ?? "this project"} using the strongest baseline and seed titles as keyword anchors`,
        rationale: "One bounded keyword refresh round after seed-based expansion.",
      },
    ],
    recommendations: [
      "Keep citation expansion bounded to these seeds before widening to free-form queries.",
      "Merge newly accepted papers into PAPER_SOURCE_INDEX.json by canonical identity before re-running graph-build.",
      "Use this packet as a research aid, not as a stage blocker.",
    ],
  };
  await writeJsonEnsured(packetPath, packet);
  await writeTextEnsured(markdownPath, buildCitationExpansionMarkdown(packet));
  return packet;
}
