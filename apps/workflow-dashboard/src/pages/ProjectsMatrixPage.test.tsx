import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../app/router";
import { WORKFLOW_STAGES } from "../lib/stage-meta";

const projectsResponse = [
  {
    id: "gcd-confirmation-bias-mitigation",
    title: "Confirmation Bias Mitigation In Graph Retrieval",
    projectRoot: "/tmp/projects/gcd-confirmation-bias-mitigation",
    currentStage: "graph_build",
    currentStageIndex: 1,
    status: "blocked",
    blockerLabel: "missing sources",
    blockerReason:
      "missing_sources: canonical papers are still missing from the shared graph",
    nextAction: "Import the missing source set and rerun graph verification.",
    updatedAt: "2026-04-09T09:30:00.000Z",
    source: "projects_state",
  },
];

describe("ProjectsMatrixPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders stages in workflow order, summarizes blockers, and navigates to project detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(projectsResponse), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const user = userEvent.setup();

    render(<AppRouter initialEntries={["/"]} />);

    expect(
      await screen.findByRole("heading", { name: /projects matrix/i }),
    ).toBeInTheDocument();

    const stageHeaders = screen.getAllByTestId(/^stage-header-/);
    expect(stageHeaders.map((header) => header.textContent)).toEqual(
      WORKFLOW_STAGES,
    );

    const matrixScroller = screen.getByTestId("stage-matrix-scroller");
    expect(matrixScroller).toHaveClass("stage-matrix__scroller");

    const identityColumn = screen.getByTestId("matrix-identity-header");
    expect(identityColumn).toHaveClass("stage-matrix__identity");

    const blockedStageCell = screen.getByTestId(
      "stage-cell-gcd-confirmation-bias-mitigation-graph_build",
    );
    expect(blockedStageCell).toHaveAttribute("data-state", "blocked");
    expect(blockedStageCell).toHaveAttribute("data-current", "true");
    expect(blockedStageCell).toHaveClass("stage-cell--blocked");
    expect(blockedStageCell).toHaveClass("stage-cell--current");
    expect(blockedStageCell).toHaveTextContent("missing sources");
    expect(blockedStageCell).not.toHaveTextContent(
      "canonical papers are still missing from the shared graph",
    );

    const projectRow = screen.getByTestId(
      "project-row-gcd-confirmation-bias-mitigation",
    );
    expect(within(projectRow).getByRole("link", { name: projectsResponse[0].title })).toBeVisible();

    await user.click(
      within(projectRow).getByRole("link", { name: projectsResponse[0].title }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: projectsResponse[0].title })).toBeInTheDocument();
    });

    expect(screen.getByText(/detail view coming soon/i)).toBeInTheDocument();
  });
});
