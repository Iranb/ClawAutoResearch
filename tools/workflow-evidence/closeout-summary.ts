import {
  normalizeAblationEvidenceState,
  normalizeBenchmarkProtocolState,
  normalizeCameraReadyEvidenceState,
  normalizeMechanismEvidenceState,
  normalizeOpportunityScorecardState,
  normalizeReproducibilityPackState,
  normalizeStatisticalEvidenceState,
  normalizeVenueCompetitionState,
} from "./contracts";

export type EvidenceCloseoutSummary = {
  status: "not_applicable" | "blocked" | "ready";
  topTierVerdict: string | null;
  blockers: string[];
  experimentAnalyzeReady: boolean;
  analyzeReviewReady: boolean;
  writeReady: boolean;
  submitReady: boolean;
  graphDependentBlockerCount: number;
  localEvidenceBlockerCount: number;
};

function isReadyLike(value: string | null | undefined): boolean {
  return ["ready", "pass", "complete", "completed", "sufficient", "strong"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

export function summarizeEvidenceCloseoutState(manifest: Record<string, unknown> | null | undefined): EvidenceCloseoutSummary {
  const benchmarkProtocol = normalizeBenchmarkProtocolState(manifest?.benchmark_protocol);
  const statisticalEvidence = normalizeStatisticalEvidenceState(manifest?.statistical_evidence);
  const venueCompetition = normalizeVenueCompetitionState(manifest?.venue_competition);
  const ablationEvidence = normalizeAblationEvidenceState(manifest?.ablation_evidence);
  const mechanismEvidence = normalizeMechanismEvidenceState(manifest?.mechanism_evidence);
  const reproducibilityPack = normalizeReproducibilityPackState(manifest?.reproducibility_pack);
  const cameraReadyEvidence = normalizeCameraReadyEvidenceState(manifest?.camera_ready_evidence);
  const opportunityScorecard = normalizeOpportunityScorecardState(manifest?.opportunity_scorecard);

  if (opportunityScorecard.verdict !== "worth_top_tier_bet") {
    return {
      status: "not_applicable",
      topTierVerdict: opportunityScorecard.verdict,
      blockers: [],
      experimentAnalyzeReady: true,
      analyzeReviewReady: true,
      writeReady: true,
      submitReady: true,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 0,
    };
  }

  const blockers: string[] = [];
  let graphDependentBlockerCount = 0;
  let localEvidenceBlockerCount = 0;

  const pushLocal = (reason: string) => {
    blockers.push(reason);
    localEvidenceBlockerCount += 1;
  };
  const pushGraph = (reason: string) => {
    blockers.push(reason);
    graphDependentBlockerCount += 1;
  };

  const experimentAnalyzeReady =
    benchmarkProtocol.status !== "missing" &&
    benchmarkProtocol.locked === true &&
    benchmarkProtocol.driftStatus !== "fail" &&
    statisticalEvidence.status !== "missing" &&
    Boolean(statisticalEvidence.claimStrengthStatus) &&
    ablationEvidence.status !== "missing" &&
    Boolean(ablationEvidence.sufficiencyStatus);
  if (!experimentAnalyzeReady) {
    if (benchmarkProtocol.status === "missing") {
      pushLocal("benchmark protocol missing");
    }
    if (benchmarkProtocol.locked !== true) {
      pushLocal("benchmark protocol not locked");
    }
    if (benchmarkProtocol.driftStatus === "fail") {
      pushLocal("benchmark protocol drift failed");
    }
    if (statisticalEvidence.status === "missing") {
      pushLocal("statistical evidence missing");
    }
    if (!statisticalEvidence.claimStrengthStatus) {
      pushLocal("statistical claim strength unset");
    }
    if (ablationEvidence.status === "missing") {
      pushLocal("ablation evidence missing");
    }
    if (!ablationEvidence.sufficiencyStatus) {
      pushLocal("ablation sufficiency unset");
    }
  }

  const analyzeReviewReady =
    mechanismEvidence.status !== "missing" &&
    !["graph_unavailable", "unverified_graph_context"].includes(
      mechanismEvidence.graphContextStatus ?? ""
    ) &&
    venueCompetition.status !== "missing" &&
    !["graph_unavailable", "unverified_graph_context"].includes(
      venueCompetition.graphContextStatus ?? ""
    );
  if (!analyzeReviewReady) {
    if (mechanismEvidence.status === "missing") {
      pushLocal("mechanism evidence missing");
    }
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        mechanismEvidence.graphContextStatus ?? ""
      )
    ) {
      pushGraph("mechanism evidence not graph-grounded");
    }
    if (venueCompetition.status === "missing") {
      pushLocal("venue competition missing");
    }
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        venueCompetition.graphContextStatus ?? ""
      )
    ) {
      pushGraph("venue competition not graph-grounded");
    }
  }

  const writeReady =
    !["graph_unavailable", "unverified_graph_context"].includes(
      venueCompetition.graphContextStatus ?? ""
    ) &&
    !["graph_unavailable", "unverified_graph_context"].includes(
      opportunityScorecard.graphContextStatus ?? ""
    ) &&
    reproducibilityPack.status !== "missing" &&
    Boolean(reproducibilityPack.environmentCaptureStatus);
  if (!writeReady) {
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        venueCompetition.graphContextStatus ?? ""
      )
    ) {
      pushGraph("write path venue competition not graph-grounded");
    }
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        opportunityScorecard.graphContextStatus ?? ""
      )
    ) {
      pushGraph("write path opportunity scorecard not graph-grounded");
    }
    if (reproducibilityPack.status === "missing") {
      pushLocal("reproducibility pack missing");
    }
    if (!reproducibilityPack.environmentCaptureStatus) {
      pushLocal("reproducibility environment capture unset");
    }
  }

  const submitReady =
    !["graph_unavailable", "unverified_graph_context"].includes(
      venueCompetition.graphContextStatus ?? ""
    ) &&
    !["graph_unavailable", "unverified_graph_context"].includes(
      opportunityScorecard.graphContextStatus ?? ""
    ) &&
    cameraReadyEvidence.status !== "missing" &&
    isReadyLike(cameraReadyEvidence.figuresStatus) &&
    isReadyLike(cameraReadyEvidence.tablesStatus) &&
    isReadyLike(cameraReadyEvidence.captionsStatus);
  if (!submitReady) {
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        venueCompetition.graphContextStatus ?? ""
      )
    ) {
      pushGraph("submit path venue competition not graph-grounded");
    }
    if (
      ["graph_unavailable", "unverified_graph_context"].includes(
        opportunityScorecard.graphContextStatus ?? ""
      )
    ) {
      pushGraph("submit path opportunity scorecard not graph-grounded");
    }
    if (cameraReadyEvidence.status === "missing") {
      pushLocal("camera-ready evidence missing");
    }
    if (!isReadyLike(cameraReadyEvidence.figuresStatus)) {
      pushLocal("camera-ready figures not ready");
    }
    if (!isReadyLike(cameraReadyEvidence.tablesStatus)) {
      pushLocal("camera-ready tables not ready");
    }
    if (!isReadyLike(cameraReadyEvidence.captionsStatus)) {
      pushLocal("camera-ready captions not ready");
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : "ready",
    topTierVerdict: opportunityScorecard.verdict,
    blockers,
    experimentAnalyzeReady,
    analyzeReviewReady,
    writeReady,
    submitReady,
    graphDependentBlockerCount,
    localEvidenceBlockerCount,
  };
}
