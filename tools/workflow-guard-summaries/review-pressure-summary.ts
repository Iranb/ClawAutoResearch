import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import type { ReviewPressurePacketState } from "../workflow-guard";

type ReviewPressureManifestLike = {
  review_pressure_packet?: unknown;
};

export async function summarizeReviewPressurePacketState(params: {
  projectRoot: string;
  manifest: ReviewPressureManifestLike;
  getReviewPressurePacketValidationErrors: (
    state: ReviewPressurePacketState
  ) => string[];
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
}): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
}> {
  const state = normalizeReviewPressurePacketState(
    params.manifest.review_pressure_packet
  );
  const validationErrors = params.getReviewPressurePacketValidationErrors(state);
  const rejectFirstReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.rejectFirstReviewPath
  );
  const unsupportedClaimAuditResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.unsupportedClaimAuditPath
  );
  const [rejectFirstReviewExists, unsupportedClaimAuditExists] = await Promise.all([
    params.fileHasNonWhitespaceContent(rejectFirstReviewResolvedPath),
    params.fileHasNonWhitespaceContent(unsupportedClaimAuditResolvedPath),
  ]);
  return {
    state,
    validationErrors,
    rejectFirstReviewResolvedPath,
    rejectFirstReviewExists,
    unsupportedClaimAuditResolvedPath,
    unsupportedClaimAuditExists,
  };
}
