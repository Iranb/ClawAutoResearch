import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";

export const DEFAULT_PREWRITE_REJECTION_SIMULATION_PATH =
  "academic_writer/PREWRITE_REJECTION_SIMULATION.md";

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function extractBulletLines(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .slice(0, 5);
}

export async function materializePrewriteRejectionSimulation(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
  reviewPressureState: ReviewPressurePacketState | null;
  artifactPath?: string | null;
}) {
  const [rejectFirstReview, noveltyAttack, unsupportedClaimAudit, limitationAudit] =
    await Promise.all([
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.rejectFirstReviewPath ?? null
        )
      ),
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.noveltyAttackPath ?? null
        )
      ),
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.unsupportedClaimAuditPath ?? null
        )
      ),
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.limitationAuditPath ?? null
        )
      ),
    ]);

  const skepticalQuestions = [
    ...extractBulletLines(rejectFirstReview),
    ...extractBulletLines(noveltyAttack),
  ];
  const claimDowngrades = extractBulletLines(unsupportedClaimAudit);
  const scopeGuards = extractBulletLines(limitationAudit);

  const doc = `# Prewrite Rejection Simulation

## Reject-First Questions
${bulletList(
  skepticalQuestions.length > 0
    ? skepticalQuestions
    : [
        "What is the narrowest version of the contribution that still survives reviewer scrutiny?",
      ]
)}

## Novelty Attack Summary
${bulletList(
  extractBulletLines(noveltyAttack).length > 0
    ? extractBulletLines(noveltyAttack)
    : ["No novelty attack artifact exists yet; assume overlap risk until proven otherwise."]
)}

## Unsupported Claim Downgrades
${bulletList(
  claimDowngrades.length > 0
    ? claimDowngrades
    : ["No unsupported claims were listed, but keep contribution wording conservative."]
)}

## Scope Boundary Before Outline Freeze
${bulletList(
  scopeGuards.length > 0
    ? scopeGuards
    : ["State the scope boundary explicitly before freezing the outline."]
)}

## Required Prewrite Actions
- Run reject-first simulation before freezing the outline.
- Confirm the main story can survive a novelty attack without claim inflation.
- Use the fallback narrative if unsupported-claim risk remains.
`;

  const artifactPath = params.artifactPath ?? DEFAULT_PREWRITE_REJECTION_SIMULATION_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve PREWRITE_REJECTION_SIMULATION.md path.");
  }
  await writeTextEnsured(resolvedPath, doc);
  return {
    path: artifactPath,
    content: doc,
  };
}
