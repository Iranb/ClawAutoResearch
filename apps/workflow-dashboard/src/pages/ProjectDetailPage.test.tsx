import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../app/router";

const projectSummaryResponse = {
  id: "gcd-confirmation-bias-mitigation",
  title: "Confirmation Bias Mitigation In Graph Retrieval",
  projectRoot: "/tmp/projects/gcd-confirmation-bias-mitigation",
  currentStage: "graph_build",
  owner: "researcher",
  status: "blocked",
  updatedAt: "2026-04-09T08:45:00.000Z",
  blockingReason:
    "missing_sources: canonical papers are still missing from the shared graph",
  nextAction: "Refresh the graph after the missing sources are imported.",
  resumeAction: null,
  papernexusPhase: "waiting_import",
  papernexusProgressSummary: "8/12 completed (4 remaining)",
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

    expect(screen.getByText(/current stage/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.currentStage)).toBeInTheDocument();
    expect(screen.getByText(/owner/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.owner)).toBeInTheDocument();
    expect(screen.getByText(/status/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.status)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    expect(screen.getByText(/blocking reason/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.blockingReason)).toBeInTheDocument();
    expect(screen.getByText(/next action/i)).toBeInTheDocument();
    expect(screen.getByText(projectSummaryResponse.nextAction)).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Manifest" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Graph" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toBeInTheDocument();
  });
});
