import { readJsonIfExists, readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type { PaperStoryState } from "../workflow-guard.js";

export const DEFAULT_CONTRIBUTION_TO_STORY_BRIDGE_PATH =
  "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function materializeContributionToStoryBridge(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
  artifactPath?: string | null;
}) {
  const [ideaToClaimMap, storySpine, claimMap] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(
        params.projectRoot,
        params.paperStoryState.ideaToClaimMapPath
      ) ?? ""
    ),
    readTextIfExists(
      resolveProjectArtifactPath(params.projectRoot, params.paperStoryState.storySpinePath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(
        params.projectRoot,
        params.paperStoryState.claimToExperimentMapPath
      )
    ),
  ]);

  const topFragments = asArray(ideaToClaimMap?.top_fragments).map(asRecord).filter(Boolean);
  const lines: string[] = ["# Contribution To Story Bridge", ""];
  lines.push("## Story Spine Snapshot");
  lines.push(storySpine?.trim() || "- story spine missing");
  lines.push("");
  lines.push("## Contribution Bridge");

  if (topFragments.length === 0) {
    lines.push("- No idea fragments are available yet; rebuild IDEA_TO_CLAIM_MAP.json first.");
  } else {
    topFragments.forEach((fragment, index) => {
      const mappedClaims = asArray(fragment?.mapped_claims)
        .map(asRecord)
        .filter(Boolean);
      lines.push(`### Contribution ${index + 1}`);
      lines.push(`- Fragment: ${asString(fragment?.title) ?? asString(fragment?.fragment_id) ?? "unknown fragment"}`);
      lines.push("- Story role: the contribution should introduce the challenge-resolving mechanism before headline wording widens.");
      lines.push(
        `- Contribution hint: ${asString(fragment?.contribution_hint) ?? "carry the fragment into the main paper claim conservatively."}`
      );
      lines.push(
        `- Linked claims: ${
          mappedClaims.length > 0
            ? mappedClaims
                .map(
                  (claim) =>
                    `${asString(claim?.claim_id) ?? "claim"} -> ${asString(claim?.claim) ?? "unspecified"}`
                )
                .join("; ")
            : "none"
        }`
      );
      lines.push(
        "- Evidence route: verify each linked claim against CLAIM_TO_EXPERIMENT_MAP.md before the section outline is frozen."
      );
      lines.push(
        "- Fallback if weak: narrow the contribution to the smallest surviving, defense-ready claim."
      );
      lines.push("");
    });
  }

  lines.push("## Claim Map Snapshot");
  lines.push(claimMap?.trim() || "- claim map missing");

  const doc = `${lines.join("\n")}\n`;
  const artifactPath = params.artifactPath ?? DEFAULT_CONTRIBUTION_TO_STORY_BRIDGE_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve CONTRIBUTION_TO_STORY_BRIDGE.md path.");
  }
  await writeTextEnsured(resolvedPath, doc);
  return {
    path: artifactPath,
    content: doc,
  };
}
