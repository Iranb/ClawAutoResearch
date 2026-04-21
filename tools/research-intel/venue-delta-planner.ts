import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
} from "../research-contracts/core/project-io";
import {
  normalizeBenchmarkProtocolState,
  normalizeOpportunityScorecardState,
  normalizeVenueCompetitionState,
} from "../research-contracts/evidence-contracts";

type DeltaPlanRow = {
  venue: string;
  canonicalId: string | null;
  title: string | null;
  objectionTag: string | null;
  deltaAxis:
    | "headline_metric_delta"
    | "protocol_locked_comparison"
    | "baseline_coverage"
    | "reproducibility"
    | "mechanism_clarity";
  requiredDelta: string;
  requiredEvidence: string[];
  currentStatus: "ready" | "partial" | "missing";
  killCondition: string | null;
};

function normalizeVenueName(value: string): string {
  return value.trim().toUpperCase();
}

function mapDeltaAxis(objectionTag: string | null): DeltaPlanRow["deltaAxis"] {
  switch ((objectionTag ?? "").trim().toLowerCase()) {
    case "recent_delta":
      return "headline_metric_delta";
    case "protocol_mismatch":
      return "protocol_locked_comparison";
    case "missing_comparison":
      return "baseline_coverage";
    case "reproducibility_challenge":
      return "reproducibility";
    default:
      return "mechanism_clarity";
  }
}

export async function materializeVenueDeltaPlan(params: {
  projectRoot: string;
  outputPath?: string;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const venueCompetition = normalizeVenueCompetitionState(manifest.venue_competition);
  const opportunity = normalizeOpportunityScorecardState(manifest.opportunity_scorecard);
  const benchmarkProtocol = normalizeBenchmarkProtocolState(manifest.benchmark_protocol);
  const objectionMapPath =
    venueCompetition.objectionMapPath ?? "researcher/VENUE_COMPETITOR_OBJECTIONS.json";
  const objectionMap =
    (await readProjectJson<Record<string, unknown>>(params.projectRoot, objectionMapPath)) ?? {};
  const objections = Array.isArray(objectionMap.objections)
    ? objectionMap.objections.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
      )
    : [];
  const targetVenues =
    venueCompetition.targetVenues.length > 0
      ? venueCompetition.targetVenues
      : ["CVPR", "ICLR", "NEURIPS"];
  const rows: DeltaPlanRow[] = targetVenues.flatMap((venue) =>
    objections.slice(0, 4).map((entry) => {
      const objectionTag =
        typeof entry.objectionTag === "string" ? entry.objectionTag : null;
      const deltaAxis = mapDeltaAxis(objectionTag);
      const requiredEvidence = Array.isArray(entry.requiredEvidence)
        ? entry.requiredEvidence.filter((value): value is string => typeof value === "string")
        : [];
      const currentStatus: DeltaPlanRow["currentStatus"] =
        benchmarkProtocol.status === "ready" &&
        benchmarkProtocol.fairCompareStatus === "pass" &&
        opportunity.positioningStatus === "ready"
          ? "ready"
          : benchmarkProtocol.status !== "missing" || requiredEvidence.length > 0
            ? "partial"
            : "missing";
      return {
        venue: normalizeVenueName(venue),
        canonicalId: typeof entry.canonicalId === "string" ? entry.canonicalId : null,
        title: typeof entry.title === "string" ? entry.title : null,
        objectionTag,
        deltaAxis,
        requiredDelta:
          deltaAxis === "headline_metric_delta"
            ? `Show a clear metric delta on ${benchmarkProtocol.benchmarkFamily ?? "the selected benchmark"} against this competitor.`
            : deltaAxis === "protocol_locked_comparison"
              ? "Lock split/backbone/harness parity before claiming superiority."
              : deltaAxis === "baseline_coverage"
                ? "Add a direct comparison row and explicit positioning against this competitor."
                : deltaAxis === "reproducibility"
                  ? "Back the comparison with a reproducible recipe and environment evidence."
                  : "Clarify what mechanism-level delta survives reviewer scrutiny.",
        requiredEvidence,
        currentStatus,
        killCondition:
          currentStatus === "missing"
            ? "Do not pitch this as a top-tier delta until benchmark/protocol or positioning evidence is present."
            : null,
      };
    })
  );
  const outputPath = params.outputPath ?? "researcher/VENUE_DELTA_PLAN.json";
  await writeProjectJson(params.projectRoot, outputPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    benchmarkFamily: benchmarkProtocol.benchmarkFamily,
    targetVenues,
    rows,
  });
  return {
    path: outputPath,
    rowCount: rows.length,
    status: rows.length > 0 ? "ready" : "missing",
  };
}
