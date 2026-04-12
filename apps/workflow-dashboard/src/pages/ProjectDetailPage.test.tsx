import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../app/router";

const projectSummaryResponse = {
  id: "gcd-confirmation-bias-mitigation",
  title: "Confirmation Bias Mitigation In Graph Retrieval",
  projectRoot: "/tmp/projects/gcd-confirmation-bias-mitigation",
  currentStage: "graph_build",
  workflowLine: "experiment",
  paperMode: null,
  owner: "researcher",
  status: "blocked",
  updatedAt: "2026-04-09T08:45:00.000Z",
  blockingReason:
    "missing_sources: canonical papers are still missing from the shared graph",
  nextAction: "Refresh the graph after the missing sources are imported.",
  resumeAction: null,
  surveyStatus: null,
  surveyTopic: null,
  surveyProgressSummary: null,
  papernexusPhase: "waiting_import",
  papernexusProgressSummary: "8/12 completed (4 remaining)",
  topTierVerdict: "worth_top_tier_bet",
  teamRoundLead: "researcher",
  teamRoundActiveSessions: 1,
  teamRoundLastClaimedTaskId: "experiment.lock_benchmark_protocol",
  teamRoundLastCompletedTaskId: "experiment.aggregate_statistics",
  teamTaskGraphTaskCount: 2,
  teamTaskGraphClaimableCount: 1,
  teamTaskGraphBlockedCount: 0,
  teamTaskGraphClaimedCount: 0,
  teamTaskGraphVerifyingCount: 0,
  teamTaskGraphNeedsRepairCount: 0,
  teamTaskGraphSatisfiedCount: 1,
  taskBoard: [
    {
      taskId: "experiment.lock_benchmark_protocol",
      title: "Lock benchmark protocol",
      owner: "orchestrator",
      status: "claimable",
      claimant: null,
      dependsOn: [],
      verificationStatus: "pending",
      latestEvent: "Task materialized from the current stage profile.",
      latestEventAt: "2026-04-09T08:45:00.000Z",
    },
  ],
  evidenceBoard: {
    benchmarkProtocolStatus: "blocked",
    benchmarkProtocolLocked: false,
    statisticalEvidenceStatus: "missing",
    statisticalEvidenceClaimStrength: null,
    venueCompetitionStatus: "missing",
    venueCompetitionGraphContextStatus: null,
    ablationEvidenceStatus: "missing",
    ablationEvidenceSufficiency: null,
    mechanismEvidenceStatus: "missing",
    mechanismEvidenceGraphContextStatus: null,
    reproducibilityPackStatus: "missing",
    reproducibilityEnvironmentStatus: null,
    cameraReadyEvidenceStatus: "missing",
    cameraReadyFiguresStatus: null,
    cameraReadyTablesStatus: null,
    cameraReadyCaptionsStatus: null,
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseoutStatus: "blocked",
  },
  source: ["manifest", "papernexus_progress"],
};

describe("ProjectDetailPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders summary cards first and exposes artifact tabs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/api/projects/gcd-confirmation-bias-mitigation/summary")) {
        return new Response(JSON.stringify(projectSummaryResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    render(
      <AppRouter
        initialEntries={["/projects/gcd-confirmation-bias-mitigation"]}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: projectSummaryResponse.title,
      }),
    ).toBeInTheDocument();

    expect(screen.getAllByText(/current stage/i)[0]).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.currentStage)).toBeInTheDocument();
    expect(screen.getByText(/workflow line/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.workflowLine)).toBeInTheDocument();
    expect(screen.getByText(/paper mode/i)).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getAllByText(/owner/i)[0]).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.owner)).toBeInTheDocument();
    expect(screen.getAllByText(/status/i)[0]).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.status)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/top-tier verdict/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.topTierVerdict)).toBeInTheDocument();
    expect(screen.getAllByText(/task graph/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/2 tasks/)).toBeInTheDocument();
    expect(screen.getAllByText(/team round/i)[0]).toBeInTheDocument();

    expect(screen.getByText(/blocking reason/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.blockingReason)).toBeInTheDocument();
    expect(screen.getByText(/next action/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.nextAction)).toBeInTheDocument();
    expect(screen.getAllByText(/benchmark protocol/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/task board/i)).toBeInTheDocument();
    expect(screen.getAllByText(projectSummaryResponse.taskBoard[0].taskId)[0]).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Manifest" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Graph" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toBeInTheDocument();
  });
});
