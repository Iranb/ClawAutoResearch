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
  claimPolicy?: { claims?: Array<{ claim_id?: string; claim_text?: string; support_label?: string }> } | null;
  targetVenue?: string | null;
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

  // Claim-grounded objections: generate specific reviewer objections
  // from actual PARTIAL/UNSUPPORTED claims when claim policy is available
  const claimGroundedObjections: string[] = [];
  const claimMitigations: string[] = [];
  const claims = params.claimPolicy?.claims ?? [];
  const weakClaims = claims.filter((c) => {
    const label = (c.support_label ?? "").toUpperCase();
    return label === "PARTIAL" || label === "UNSUPPORTED";
  });

  for (const claim of weakClaims.slice(0, 5)) {
    const label = (claim.support_label ?? "").toUpperCase();
    const text = claim.claim_text ?? claim.claim_id ?? "unnamed claim";
    if (label === "UNSUPPORTED") {
      claimGroundedObjections.push(
        `Claim "${text}" has no experimental support — a reviewer will reject this as unsubstantiated.`
      );
      claimMitigations.push(
        `For "${text}": either run a targeted experiment, reframe as a hypothesis/conjecture, or reduce scope to remove.`
      );
    } else if (label === "PARTIAL") {
      claimGroundedObjections.push(
        `Claim "${text}" has only partial support (1 experiment) — a reviewer may request additional validation.`
      );
      claimMitigations.push(
        `For "${text}": add a second supporting experiment with different conditions, or weaken claim wording to "preliminary evidence suggests..."`
      );
    }
  }

  const venueTag = params.targetVenue ? ` (${params.targetVenue})` : "";

  const doc = `# Prewrite Rejection Simulation${venueTag}

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

${claimGroundedObjections.length > 0 ? `## Claim-Grounded Reviewer Objections

${bulletList(claimGroundedObjections)}

## Mitigation Strategies

${bulletList(claimMitigations)}
` : ""}## Scope Boundary Before Outline Freeze
${bulletList(
  scopeGuards.length > 0
    ? scopeGuards
    : ["State the scope boundary explicitly before freezing the outline."]
)}

## Claim Support Snapshot
- Supported: ${params.paperStoryState.supportedClaimCount}
- Partial: ${params.paperStoryState.partialClaimCount}
- Unsupported: ${params.paperStoryState.unsupportedClaimCount}
- Overall status: ${params.paperStoryState.claimSupportStatus}

## Required Prewrite Actions
- Run reject-first simulation before freezing the outline.
- Confirm the main story can survive a novelty attack without claim inflation.
- Use the fallback narrative if unsupported-claim risk remains.
${claimGroundedObjections.length > 0 ? "- Address all claim-grounded objections above before proceeding to WRITE.\n" : ""}`;

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
