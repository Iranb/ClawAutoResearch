import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import type { PaperStoryState } from "../workflow-guard";

type PaperStoryManifestLike = {
  paper_story_state?: unknown;
};

export async function summarizePaperStoryState(params: {
  projectRoot: string;
  manifest: PaperStoryManifestLike;
  getPaperStoryStateValidationErrors: (state: PaperStoryState) => string[];
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
}): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
  fallbackNarrativeResolvedPath: string | null;
  fallbackNarrativeExists: boolean;
}> {
  const state = normalizePaperStoryState(params.manifest.paper_story_state);
  const validationErrors = params.getPaperStoryStateValidationErrors(state);
  const storySpineResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.storySpinePath
  );
  const claimToExperimentMapResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.claimToExperimentMapPath
  );
  const fallbackNarrativeResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.fallbackNarrativePath
  );
  const [storySpineExists, claimToExperimentMapExists, fallbackNarrativeExists] =
    await Promise.all([
      params.fileHasNonWhitespaceContent(storySpineResolvedPath),
      params.fileHasNonWhitespaceContent(claimToExperimentMapResolvedPath),
      params.fileHasNonWhitespaceContent(fallbackNarrativeResolvedPath),
    ]);
  return {
    state,
    validationErrors,
    storySpineResolvedPath,
    storySpineExists,
    claimToExperimentMapResolvedPath,
    claimToExperimentMapExists,
    fallbackNarrativeResolvedPath,
    fallbackNarrativeExists,
  };
}
