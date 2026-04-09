import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RawFileViewer } from "./RawFileViewer";

describe("RawFileViewer", () => {
  it("pretty-renders JSON artifacts", () => {
    render(
      <RawFileViewer
        artifact={{
          path: "/tmp/GRAPH_PRESENCE_CHECK.json",
          kind: "json",
          status: "ok",
          content: '{\n  "status": "missing_sources"\n}',
          metadata: {
            presentation: "pretty-json",
          },
        }}
        title="Graph Presence Check"
      />,
    );

    expect(screen.getByText("Graph Presence Check")).toBeInTheDocument();
    expect(screen.getByText(/pretty json/i)).toBeInTheDocument();
    expect(screen.getByText(/"status": "missing_sources"/i)).toBeInTheDocument();
  });

  it("shows JSONL truncation notes", () => {
    render(
      <RawFileViewer
        artifact={{
          path: "/tmp/workflow-trace.jsonl",
          kind: "jsonl",
          status: "ok",
          content: '{"seq":3}\n{"seq":4}\n{"seq":5}\n{"seq":6}\n{"seq":7}',
          metadata: {
            presentation: "recent-lines",
            totalLines: 7,
            shownLines: 5,
            truncated: true,
            truncationNote: "Showing the most recent 5 of 7 lines.",
          },
        }}
        title="Workflow Trace"
      />,
    );

    expect(screen.getByText(/showing the most recent 5 of 7 lines\./i)).toBeInTheDocument();
    expect(screen.getByText(/workflow trace/i)).toBeInTheDocument();
  });

  it("shows explicit missing and invalid artifact states", () => {
    const { rerender } = render(
      <RawFileViewer
        artifact={{
          path: "/tmp/workflow-mailbox.json",
          kind: "json",
          status: "missing",
          content: "",
          metadata: {
            presentation: "plain-text",
            note: "missing artifact",
          },
        }}
        title="Workflow Mailbox"
      />,
    );

    expect(screen.getByText(/missing artifact/i)).toBeInTheDocument();

    rerender(
      <RawFileViewer
        artifact={{
          path: "/tmp/broken.json",
          kind: "json",
          status: "invalid",
          content: '{\n  "broken": true,\n',
          metadata: {
            presentation: "plain-text",
            note: "invalid artifact",
          },
        }}
        title="Broken JSON"
      />,
    );

    expect(screen.getByText(/invalid artifact/i)).toBeInTheDocument();
    expect(screen.getByText(/"broken": true/i)).toBeInTheDocument();
  });
});
