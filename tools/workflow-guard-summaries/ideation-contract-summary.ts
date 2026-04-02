import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeIdeationContractState } from "../workflow-guard-state/ideation-contract";
import type { IdeationContractState } from "../workflow-guard";

type IdeationManifestLike = {
  ideation_contract?: unknown;
};

export async function summarizeIdeationContractState(params: {
  projectRoot: string;
  manifest: IdeationManifestLike;
  getIdeationContractValidationErrors: (state: IdeationContractState) => string[];
  fileHasMeaningfulJsonContent: (targetPath: string | null) => Promise<boolean>;
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
}): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
  noveltyTreeResolvedPath: string | null;
  noveltyTreeExists: boolean;
  challengeInsightTreeResolvedPath: string | null;
  challengeInsightTreeExists: boolean;
  candidatePoolResolvedPath: string | null;
  candidatePoolExists: boolean;
  scoreboardResolvedPath: string | null;
  scoreboardExists: boolean;
}> {
  const state = normalizeIdeationContractState(params.manifest.ideation_contract);
  const validationErrors = params.getIdeationContractValidationErrors(state);
  const graphIdeationPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.graphIdeationPacketPath
  );
  const researchProposalResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.researchProposalPath
  );
  const noveltyTreeResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.noveltyTreePath
  );
  const challengeInsightTreeResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.challengeInsightTreePath
  );
  const candidatePoolResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.candidatePoolPath
  );
  const scoreboardResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.tournamentScoreboardPath
  );
  const [
    graphIdeationPacketExists,
    researchProposalExists,
    noveltyTreeExists,
    challengeInsightTreeExists,
    candidatePoolExists,
    scoreboardExists,
  ] = await Promise.all([
    params.fileHasMeaningfulJsonContent(graphIdeationPacketResolvedPath),
    params.fileHasNonWhitespaceContent(researchProposalResolvedPath),
    params.fileHasNonWhitespaceContent(noveltyTreeResolvedPath),
    params.fileHasNonWhitespaceContent(challengeInsightTreeResolvedPath),
    params.fileHasMeaningfulJsonContent(candidatePoolResolvedPath),
    params.fileHasMeaningfulJsonContent(scoreboardResolvedPath),
  ]);
  return {
    state,
    validationErrors,
    graphIdeationPacketResolvedPath,
    graphIdeationPacketExists,
    researchProposalResolvedPath,
    researchProposalExists,
    noveltyTreeResolvedPath,
    noveltyTreeExists,
    challengeInsightTreeResolvedPath,
    challengeInsightTreeExists,
    candidatePoolResolvedPath,
    candidatePoolExists,
    scoreboardResolvedPath,
    scoreboardExists,
  };
}
