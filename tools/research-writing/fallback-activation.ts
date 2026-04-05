import { readTextIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";

export const DEFAULT_FALLBACK_ACTIVATION_PATH =
  "academic_writer/FALLBACK_ACTIVATION.json";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function extractClaimIds(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  const matches = rawText.match(/\bclaim[-_ ]?\d+\b/gi) ?? [];
  return uniqueStrings(matches.map((entry) => entry.toLowerCase().replace(/\s+/g, "-")));
}

export async function materializeFallbackActivation(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
  reviewPressureState: ReviewPressurePacketState | null;
  artifactPath?: string | null;
}) {
  const [unsupportedAudit, noveltyAttack, rejectFirstReview, limitationAudit] =
    await Promise.all([
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.unsupportedClaimAuditPath ?? null
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
          params.reviewPressureState?.rejectFirstReviewPath ?? null
        )
      ),
      readTextIfExists(
        resolveProjectArtifactPath(
          params.projectRoot,
          params.reviewPressureState?.limitationAuditPath ?? null
        )
      ),
    ]);

  const blockingClaimIds = uniqueStrings([
    ...extractClaimIds(unsupportedAudit),
    ...extractClaimIds(noveltyAttack),
  ]);
  const reasons = uniqueStrings([
    params.paperStoryState.claimSupportStatus === "unsupported"
      ? "unsupported claim support remains in the main story"
      : null,
    params.paperStoryState.unsupportedClaimCount > 0
      ? `${params.paperStoryState.unsupportedClaimCount} unsupported claim(s) remain`
      : null,
    params.paperStoryState.partialClaimCount > 0
      ? `${params.paperStoryState.partialClaimCount} partial claim(s) still need stronger evidence`
      : null,
    unsupportedAudit && unsupportedAudit.trim().length > 0
      ? "unsupported claim audit still lists blocking items"
      : null,
    noveltyAttack && noveltyAttack.trim().length > 0
      ? "novelty attack found overclaim risk"
      : null,
    rejectFirstReview && rejectFirstReview.trim().length > 0
      ? "reject-first review still sees unresolved reviewer pressure"
      : null,
    limitationAudit && limitationAudit.trim().length > 0
      ? "limitation audit recommends a narrower scope boundary"
      : null,
  ]);

  const shouldFallback =
    params.paperStoryState.claimSupportStatus === "unsupported" ||
    params.paperStoryState.unsupportedClaimCount > 0 ||
    (params.paperStoryState.partialClaimCount > 0 && reasons.length > 1);

  const activation = {
    status: "ready",
    activeNarrativeMode: shouldFallback ? "fallback" : "main",
    triggerReason: shouldFallback
      ? reasons.join("; ")
      : "main narrative remains support-safe",
    blockingClaimIds,
    recommendedStorySwitch: shouldFallback
      ? "Narrow the story to the bounded, evidence-backed contribution and move weak claims into limitations or future work."
      : "Keep the main narrative, but continue monitoring unsupported-claim drift.",
    evidenceSignals: reasons,
    generatedAt: new Date().toISOString(),
  };

  const artifactPath = params.artifactPath ?? DEFAULT_FALLBACK_ACTIVATION_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve FALLBACK_ACTIVATION.json path.");
  }
  await writeJsonEnsured(resolvedPath, {
    status: activation.status,
    active_narrative_mode: activation.activeNarrativeMode,
    trigger_reason: activation.triggerReason,
    blocking_claim_ids: activation.blockingClaimIds,
    recommended_story_switch: activation.recommendedStorySwitch,
    evidence_signals: activation.evidenceSignals,
    generated_at: activation.generatedAt,
  });
  return {
    path: artifactPath,
    activation,
  };
}
