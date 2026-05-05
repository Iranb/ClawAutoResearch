import type { BroadPaperProviderQueryResult, BroadPaperSearchQuery } from "./provider-contract";
import type { MergedPaperCandidate } from "./merge";

export type BroadPaperSearchDiagnostics = {
  generatedAt: string;
  topic: string;
  queryCount: number;
  providerStatuses: Record<
    string,
    { ok: number; skipped: number; error: number; degraded: number }
  >;
  providerCoverage: Record<string, number>;
  mergedCandidateCount: number;
  metadataOnlyCount: number;
  venueCoverage: Record<string, number>;
};

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = typeof value === "string" && value.trim() ? value.trim() : null;
    if (!key) {
      continue;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function buildBroadPaperSearchDiagnostics(params: {
  topic: string;
  queryPlan: BroadPaperSearchQuery[];
  queryResults: BroadPaperProviderQueryResult[];
  mergedCandidates: MergedPaperCandidate[];
}): BroadPaperSearchDiagnostics {
  const providerStatuses: Record<
    string,
    { ok: number; skipped: number; error: number; degraded: number }
  > = {};
  for (const result of params.queryResults) {
    providerStatuses[result.provider] ??= { ok: 0, skipped: 0, error: 0, degraded: 0 };
    providerStatuses[result.provider][result.status] += 1;
  }
  const providerCoverage = countBy(
    params.mergedCandidates.flatMap((entry) => entry.retrievalProviders)
  );
  return {
    generatedAt: new Date().toISOString(),
    topic: params.topic,
    queryCount: params.queryPlan.length,
    providerStatuses,
    providerCoverage,
    mergedCandidateCount: params.mergedCandidates.length,
    metadataOnlyCount: params.mergedCandidates.filter((entry) => entry.metadataOnly).length,
    venueCoverage: countBy(params.mergedCandidates.map((entry) => entry.venueFamily ?? entry.venue)),
  };
}

export function renderBroadPaperSearchMarkdown(params: {
  topic: string;
  queryPlan: BroadPaperSearchQuery[];
  queryResults: BroadPaperProviderQueryResult[];
  mergedCandidates: MergedPaperCandidate[];
  diagnostics: BroadPaperSearchDiagnostics;
}): string {
  const lines = [
    "# Broad Paper Search Report",
    "",
    `- Topic: ${params.topic}`,
    `- Generated at: ${params.diagnostics.generatedAt}`,
    `- Queries: ${params.diagnostics.queryCount}`,
    `- Merged candidates: ${params.diagnostics.mergedCandidateCount}`,
    `- Metadata-only unresolved: ${params.diagnostics.metadataOnlyCount}`,
    "",
    "## Query Plan",
  ];
  for (const query of params.queryPlan) {
    lines.push(`- [${query.family}] ${query.query}`);
  }
  lines.push("", "## Provider Status");
  for (const [provider, counts] of Object.entries(params.diagnostics.providerStatuses)) {
    lines.push(
      `- ${provider}: ok=${counts.ok} skipped=${counts.skipped} degraded=${counts.degraded} error=${counts.error}`
    );
  }
  lines.push("", "## Top Candidates");
  for (const candidate of params.mergedCandidates.slice(0, 20)) {
    lines.push(
      `- ${candidate.title ?? candidate.canonicalId} | score=${candidate.selectionScore.toFixed(
        1
      )} | providers=${candidate.retrievalProviders.join(", ") || "none"} | venue=${
        candidate.venueFamily ?? candidate.venue ?? "unknown"
      } | resolution=${candidate.resolutionStatus}`
    );
  }
  return `${lines.join("\n")}\n`;
}
