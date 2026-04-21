import {
  nowIso,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io";
import {
  normalizeOpportunityScorecardState,
  normalizeVenueCompetitionState,
  serializeOpportunityScorecardState,
  serializeVenueCompetitionState,
} from "../research-contracts/evidence-contracts";
import { materializePaperIdentityRegistry } from "./paper-identity-registry";

type CompetitorSlateEntry = {
  canonicalId: string;
  title: string | null;
  venue: string | null;
  year: number | null;
  citationCount: number | null;
  maturity: string;
  comparisonReason: string;
};

type CompetitorObjectionEntry = {
  canonicalId: string;
  title: string | null;
  venue: string | null;
  objectionTag:
    | "recent_delta"
    | "missing_comparison"
    | "reproducibility_challenge"
    | "protocol_mismatch";
  reviewerObjection: string;
  requiredEvidence: string[];
};

function deriveTargetVenues(manifest: Record<string, unknown>): string[] {
  const researchProgram = manifest.research_program as Record<string, unknown> | undefined;
  const explicit = researchProgram?.target_venues ?? researchProgram?.targetVenues;
  if (Array.isArray(explicit)) {
    return explicit.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return ["cvpr", "iccv", "eccv", "iclr", "neurips"];
}

function buildCompetitorSlateEntries(entries: Awaited<ReturnType<typeof materializePaperIdentityRegistry>>["entries"]): CompetitorSlateEntry[] {
  return entries
    .filter((entry) => entry.maturity !== "uncertain")
    .sort((left, right) => {
      const yearDelta = (right.year ?? 0) - (left.year ?? 0);
      if (yearDelta !== 0) {
        return yearDelta;
      }
      return (right.citationCount ?? 0) - (left.citationCount ?? 0);
    })
    .slice(0, 8)
    .map((entry) => ({
      canonicalId: entry.canonicalId,
      title: entry.title,
      venue: entry.venue,
      year: entry.year,
      citationCount: entry.citationCount,
      maturity: entry.maturity,
      comparisonReason:
        entry.year && entry.year >= new Date().getUTCFullYear() - 2
          ? "recent_competitor"
          : "canonical_background",
    }));
}

function buildCompetitorObjectionEntries(params: {
  competitors: CompetitorSlateEntry[];
  benchmarkFamily: string | null;
  fairCompareStatus: string | null;
  targetVenues: string[];
}): CompetitorObjectionEntry[] {
  const venueLabel =
    params.targetVenues.length > 0 ? params.targetVenues.slice(0, 2).join("/") : "top-tier venue";
  return params.competitors.map((entry) => {
    const benchmarkPhrase = params.benchmarkFamily
      ? ` on ${params.benchmarkFamily}`
      : "";
    if (entry.comparisonReason === "recent_competitor") {
      return {
        canonicalId: entry.canonicalId,
        title: entry.title,
        venue: entry.venue,
        objectionTag:
          params.fairCompareStatus === "pass" ? "recent_delta" : "protocol_mismatch",
        reviewerObjection:
          params.fairCompareStatus === "pass"
            ? `A ${venueLabel} reviewer will ask for the exact delta over this recent competitor${benchmarkPhrase}, not a generic novelty claim.`
            : `A ${venueLabel} reviewer will question whether the claimed delta over this recent competitor is fair until the benchmark/protocol comparison is explicit${benchmarkPhrase}.`,
        requiredEvidence:
          params.fairCompareStatus === "pass"
            ? ["benchmark_protocol", "statistical_evidence", "mechanism_evidence"]
            : ["benchmark_protocol", "fair_compare_matrix", "survey_traceability"],
      };
    }
    return {
      canonicalId: entry.canonicalId,
      title: entry.title,
      venue: entry.venue,
      objectionTag:
        entry.maturity === "preprint_with_metadata"
          ? "reproducibility_challenge"
          : "missing_comparison",
      reviewerObjection:
        entry.maturity === "preprint_with_metadata"
          ? `A reviewer may challenge whether this comparison is reproducible enough to support a strong claim${benchmarkPhrase}.`
          : `A reviewer will ask why this established paper is not treated as a direct comparison anchor${benchmarkPhrase}.`,
      requiredEvidence:
        entry.maturity === "preprint_with_metadata"
          ? ["reproducibility_pack", "benchmark_protocol", "citation_integrity"]
          : ["benchmark_protocol", "venue_competition", "claim_evidence"],
    };
  });
}

export async function materializeVenueCompetitionIntel(params: {
  projectRoot: string;
  outputPath?: string;
  patch?: Record<string, unknown>;
}): Promise<ReturnType<typeof normalizeVenueCompetitionState>> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeVenueCompetitionState(manifest.venue_competition);
  const patch = params.patch ?? {};
  const registry = await materializePaperIdentityRegistry({ projectRoot: params.projectRoot });
  const benchmarkProtocol =
    manifest.benchmark_protocol && typeof manifest.benchmark_protocol === "object"
      ? (manifest.benchmark_protocol as Record<string, unknown>)
      : null;
  const defaultTargetVenues =
    current.targetVenues.length > 0 ? current.targetVenues : deriveTargetVenues(manifest);
  const targetVenues =
    (Array.isArray(patch.target_venues) ? patch.target_venues : Array.isArray(patch.targetVenues) ? patch.targetVenues : null)?.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    ) ??
    defaultTargetVenues;
  const competitorSlate = buildCompetitorSlateEntries(registry.entries);
  const competitorObjections = buildCompetitorObjectionEntries({
    competitors: competitorSlate,
    benchmarkFamily:
      (typeof benchmarkProtocol?.benchmark_family === "string" && benchmarkProtocol.benchmark_family) ||
      (typeof benchmarkProtocol?.benchmarkFamily === "string" && benchmarkProtocol.benchmarkFamily) ||
      null,
    fairCompareStatus:
      (typeof benchmarkProtocol?.fair_compare_status === "string" && benchmarkProtocol.fair_compare_status) ||
      (typeof benchmarkProtocol?.fairCompareStatus === "string" && benchmarkProtocol.fairCompareStatus) ||
      null,
    targetVenues,
  });
  const acceptanceRiskStatus =
    competitorSlate.length >= 5 ? "crowded" : competitorSlate.length >= 2 ? "competitive" : "thin_signal";
  const defaultCompetitorSlatePath =
    current.competitorSlatePath ?? "researcher/VENUE_COMPETITION.json";
  const defaultObjectionMapPath =
    current.objectionMapPath ?? "researcher/VENUE_COMPETITOR_OBJECTIONS.json";
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? defaultCompetitorSlatePath,
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      targetVenues,
      competitorSlate,
      acceptanceRiskStatus,
      registryCoverage: registry.counts,
    }
  );
  await writeProjectJson(
    params.projectRoot,
    (typeof patch.objection_map_path === "string" && patch.objection_map_path) ||
      (typeof patch.objectionMapPath === "string" && patch.objectionMapPath) ||
      defaultObjectionMapPath,
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      targetVenues,
      benchmarkFamily:
        (typeof benchmarkProtocol?.benchmark_family === "string" && benchmarkProtocol.benchmark_family) ||
        (typeof benchmarkProtocol?.benchmarkFamily === "string" && benchmarkProtocol.benchmarkFamily) ||
        null,
      objections: competitorObjections,
    }
  );
  const next = normalizeVenueCompetitionState({
    ...serializeVenueCompetitionState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      (competitorSlate.length > 0 ? "ready" : "partial"),
    target_venues: targetVenues,
    competitor_slate_path:
      params.outputPath ||
      (typeof patch.competitor_slate_path === "string" && patch.competitor_slate_path) ||
      (typeof patch.competitorSlatePath === "string" && patch.competitorSlatePath) ||
      defaultCompetitorSlatePath,
    objection_map_path:
      (typeof patch.objection_map_path === "string" && patch.objection_map_path) ||
      (typeof patch.objectionMapPath === "string" && patch.objectionMapPath) ||
      defaultObjectionMapPath,
    objection_count:
      (typeof patch.objection_count === "number" && Number.isFinite(patch.objection_count)) ||
      (typeof patch.objectionCount === "number" && Number.isFinite(patch.objectionCount))
        ? Number(patch.objection_count ?? patch.objectionCount)
        : competitorObjections.length,
    acceptance_risk_status:
      (typeof patch.acceptance_risk_status === "string" && patch.acceptance_risk_status) ||
      (typeof patch.acceptanceRiskStatus === "string" && patch.acceptanceRiskStatus) ||
      acceptanceRiskStatus,
    graph_context_status:
      (typeof patch.graph_context_status === "string" && patch.graph_context_status) ||
      (typeof patch.graphContextStatus === "string" && patch.graphContextStatus) ||
      (competitorSlate.length > 0 ? "ready" : "missing"),
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (competitorSlate.length > 0 ? null : "No canonical competitor slate could be derived."),
    last_materialized_at: nowIso(),
  });
  manifest.venue_competition = serializeVenueCompetitionState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}

export async function materializeOpportunityScorecard(params: {
  projectRoot: string;
  outputPath?: string;
  patch?: Record<string, unknown>;
}): Promise<ReturnType<typeof normalizeOpportunityScorecardState>> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeOpportunityScorecardState(manifest.opportunity_scorecard);
  const patch = params.patch ?? {};
  const venueCompetition = await materializeVenueCompetitionIntel({
    projectRoot: params.projectRoot,
  });
  const benchmarkProtocol = manifest.benchmark_protocol as Record<string, unknown> | undefined;
  const statisticalEvidence = manifest.statistical_evidence as Record<string, unknown> | undefined;
  const benchmarkLocked = Boolean(benchmarkProtocol?.locked);
  const statisticalReady = typeof statisticalEvidence?.status === "string" && statisticalEvidence.status !== "missing";
  const graphContextStatus = venueCompetition.graphContextStatus ?? "missing";
  const score = [
    venueCompetition.status === "ready" ? 1 : 0,
    benchmarkLocked ? 1 : 0,
    statisticalReady ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const verdict =
    score >= 3 ? "worth_top_tier_bet" : score === 2 ? "needs_stronger_evidence" : "not_ready_for_top_tier";
  const defaultScorecardPath = current.scorecardPath ?? "researcher/TOP_TIER_OPPORTUNITY.json";
  const scorecardPath =
    params.outputPath ||
    (typeof patch.scorecard_path === "string" && patch.scorecard_path) ||
    (typeof patch.scorecardPath === "string" && patch.scorecardPath) ||
    defaultScorecardPath;
  await writeProjectJson(params.projectRoot, scorecardPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    verdict,
    score,
    targetVenues: venueCompetition.targetVenues,
    benchmarkLocked,
    statisticalReady,
    graphContextStatus,
    acceptanceRiskStatus: venueCompetition.acceptanceRiskStatus,
  });
  const next = normalizeOpportunityScorecardState({
    ...serializeOpportunityScorecardState(current),
    schema_version: 2,
    status: (typeof patch.status === "string" && patch.status) || (score >= 2 ? "ready" : "partial"),
    verdict:
      (typeof patch.verdict === "string" && patch.verdict) ||
      verdict,
    scorecard_path: scorecardPath,
    graph_context_status:
      (typeof patch.graph_context_status === "string" && patch.graph_context_status) ||
      (typeof patch.graphContextStatus === "string" && patch.graphContextStatus) ||
      graphContextStatus,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (verdict === "worth_top_tier_bet"
        ? null
        : "Top-tier opportunity remains weak until benchmark lock, statistical evidence, and competitor slate are all in place."),
    last_materialized_at: nowIso(),
  });
  manifest.opportunity_scorecard = serializeOpportunityScorecardState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
