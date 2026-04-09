import { readFile } from "node:fs/promises";

import type { ArtifactKind } from "./project-artifacts.js";
import { formatArtifact, type FormattedArtifact } from "../utils/format-artifact.js";

export type RawArtifact = FormattedArtifact & {
  path: string;
};

export async function readRawArtifact(params: {
  filePath: string;
  kind: ArtifactKind;
  recentLineCount?: number;
}): Promise<RawArtifact> {
  try {
    const rawContent = await readFile(params.filePath, "utf8");

    return {
      path: params.filePath,
      ...formatArtifact({
        kind: params.kind,
        rawContent,
        recentLineCount: params.recentLineCount,
      }),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return {
        path: params.filePath,
        kind: params.kind,
        status: "missing",
        content: "",
        metadata: {
          presentation: "plain-text",
          note: "missing artifact",
        },
      };
    }

    throw error;
  }
}
