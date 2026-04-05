import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeTextEnsured,
} from "../workflow-guard-core/fs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstBullet(text: string | null, fallback: string): string {
  if (!text) {
    return fallback;
  }
  const match = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^[-*]\s+/.test(line));
  return match ? match.replace(/^[-*]\s+/, "").trim() : fallback;
}

export async function materializeRebuttalResponse(params: {
  projectRoot: string;
  reviewPressureState: { status: string } | null;
  artifactPath?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
    {};
  const externalReview = asRecord(manifest.external_review_state) ?? {};
  const externalReviewPath =
    asString(externalReview.external_review_path ?? externalReview.externalReviewPath) ??
    null;
  if (!externalReviewPath) {
    return null;
  }
  const targetPath =
    params.artifactPath ??
    asString(externalReview.review_response_path ?? externalReview.reviewResponsePath) ??
    `reviewer/rebuttal_${new Date().toISOString().slice(0, 10)}.md`;
  const [externalReviewText, noveltyAttack, unsupportedClaims, rejectionReview] =
    await Promise.all([
      readTextIfExists(path.join(projectRoot, externalReviewPath)),
      readTextIfExists(path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md")),
      readTextIfExists(
        path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md")
      ),
      readTextIfExists(
        path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md")
      ),
    ]);

  const topConcern = firstBullet(
    externalReviewText,
    "Clarify the novelty boundary and tie every response to concrete evidence."
  );
  const packet = `# Rebuttal Draft

## Response Summary

We address the review conservatively: narrow the main narrative where support is still partial, preserve only evidence-backed claims, and document exactly which manuscript changes and evidence packets answer each concern.

## Top Priorities

1. ${topConcern}
2. ${firstBullet(noveltyAttack, "Resolve novelty-overlap concerns with a narrower contribution claim.")}
3. ${firstBullet(unsupportedClaims, "Downgrade or remove unsupported claims instead of defending them aggressively.")}

## Point-by-Point Responses

### Concern 1
- Priority Color: red
- Champion Strategy: downgrade_claim
- Reviewer concern: ${topConcern}
- Evidence / revision plan: Narrow the contribution to the bounded, measured gain and point the response to the updated claim-evidence matrix and revised introduction language.

### Concern 2
- Priority Color: amber
- Champion Strategy: fix_now
- Reviewer concern: ${firstBullet(rejectionReview, "The paper needs a cleaner reviewer-facing defense.")}
- Evidence / revision plan: Reorder the response around the main evidence spine, then list the exact manuscript edits and figure/table anchors that answer the concern.

### Concern 3
- Priority Color: green
- Champion Strategy: rebut_with_existing_evidence
- Reviewer concern: ${firstBullet(noveltyAttack, "Demonstrate why the work is more than a baseline cleanup.")}
- Evidence / revision plan: Cite the existing routing delta, baseline comparison, and scope boundary explicitly instead of inventing new evidence.

## Closing

We will keep the revision bounded to supported claims, make the novelty boundary explicit, and ensure every response is anchored to an existing evidence artifact or a concrete manuscript change.
`;
  await writeTextEnsured(path.join(projectRoot, targetPath), packet);
  return {
    path: targetPath,
    topConcern,
    sourceReviewPath: externalReviewPath,
  };
}
