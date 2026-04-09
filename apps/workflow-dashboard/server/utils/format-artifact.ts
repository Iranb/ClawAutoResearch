import type { ArtifactKind } from "../read-models/project-artifacts.js";

export type RawArtifactMetadata = {
  presentation: "pretty-json" | "rendered-source" | "recent-lines" | "plain-text";
  totalLines?: number;
  shownLines?: number;
  truncated?: boolean;
  truncationNote?: string | null;
  note?: string;
};

export type FormattedArtifact = {
  kind: ArtifactKind;
  status: "ok" | "missing" | "invalid";
  content: string;
  metadata: RawArtifactMetadata;
};

export function formatArtifact(params: {
  kind: ArtifactKind;
  rawContent: string;
  recentLineCount?: number;
}): FormattedArtifact {
  if (params.kind === "json") {
    return formatJsonArtifact(params.rawContent);
  }

  if (params.kind === "markdown") {
    return {
      kind: "markdown",
      status: "ok",
      content: params.rawContent,
      metadata: {
        presentation: "rendered-source",
      },
    };
  }

  if (params.kind === "jsonl") {
    return formatJsonlArtifact(params.rawContent, params.recentLineCount ?? 5);
  }

  return {
    kind: "text",
    status: "ok",
    content: params.rawContent,
    metadata: {
      presentation: "plain-text",
    },
  };
}

function formatJsonArtifact(rawContent: string): FormattedArtifact {
  try {
    return {
      kind: "json",
      status: "ok",
      content: JSON.stringify(JSON.parse(rawContent), null, 2),
      metadata: {
        presentation: "pretty-json",
      },
    };
  } catch {
    return {
      kind: "json",
      status: "invalid",
      content: rawContent,
      metadata: {
        presentation: "plain-text",
        note: "invalid artifact",
      },
    };
  }
}

function formatJsonlArtifact(
  rawContent: string,
  recentLineCount: number,
): FormattedArtifact {
  const totalLines = rawContent
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  const shownLines = totalLines.slice(-recentLineCount);
  const truncated = shownLines.length < totalLines.length;

  return {
    kind: "jsonl",
    status: "ok",
    content: shownLines.join("\n"),
    metadata: {
      presentation: "recent-lines",
      totalLines: totalLines.length,
      shownLines: shownLines.length,
      truncated,
      truncationNote: truncated
        ? `Showing the most recent ${shownLines.length} of ${totalLines.length} lines.`
        : null,
    },
  };
}
