import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type { PaperStoryState } from "../workflow-guard.js";

export const DEFAULT_FIGURE_ANCHOR_PLAN_PATH =
  "academic_writer/FIGURE_ANCHOR_PLAN.md";

function extractClaimIds(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  const matches = rawText.match(/\bclaim[-_ ]?\d+\b/gi) ?? [];
  return Array.from(new Set(matches.map((entry) => entry.toLowerCase().replace(/\s+/g, "-"))));
}

export async function materializeFigureAnchorPlan(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
  artifactPath?: string | null;
}) {
  const [pipelineSketch, claimMap] = await Promise.all([
    readTextIfExists(
      resolveProjectArtifactPath(
        params.projectRoot,
        params.paperStoryState.pipelineFigureSketchPath
      )
    ),
    readTextIfExists(
      resolveProjectArtifactPath(
        params.projectRoot,
        params.paperStoryState.claimToExperimentMapPath
      )
    ),
  ]);

  const claimIds = extractClaimIds(claimMap);
  const doc = `# Figure Anchor Plan

## Primary Anchor Figure
- Figure 1: pipeline / method anchor
- Purpose: make the contribution structure visible before prose expands
- Backing sketch: ${params.paperStoryState.pipelineFigureSketchPath ?? "academic_writer/story/PIPELINE_FIGURE_SKETCH.md"}

## Anchor Narrative
- The primary figure should explain why the method feels necessary, not just how it is assembled.
- The opening paragraphs should point to Figure 1 before introducing secondary tables.

## Claim Anchors
${claimIds.length > 0 ? claimIds.map((claimId) => `- ${claimId} -> Table/Figure evidence slot`).join("\n") : "- claim anchors will be filled from the claim map"}

## Figure-Centric Revision Reminders
- If the prose cannot be summarized through the anchor figure, narrow the story.
- Prefer one memorable anchor figure over several weak decorative figures.

## Pipeline Sketch Snapshot
${pipelineSketch?.trim() || "- pipeline sketch not found yet"}
`;

  const artifactPath = params.artifactPath ?? DEFAULT_FIGURE_ANCHOR_PLAN_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve FIGURE_ANCHOR_PLAN.md path.");
  }
  await writeTextEnsured(resolvedPath, doc);
  return {
    path: artifactPath,
    content: doc,
  };
}
