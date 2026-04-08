import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizeStage, pickString } from "../workflow-guard-core/coercion";
import { pathExists, readJsonIfExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeCitationIntegrityState,
} from "../workflow-guard-state/authoring-review-state";
import {
  normalizeCitationCollectionState,
} from "../workflow-guard-state/execution-state";
import {
  normalizeTheoryStateFile,
  normalizeTheorySupportState,
} from "../workflow-guard-state/theory-state";

type CitationCollectionStateLike = ReturnType<typeof normalizeCitationCollectionState>;
type CitationIntegrityStateLike = ReturnType<typeof normalizeCitationIntegrityState>;
type TheorySupportStateLike = ReturnType<typeof normalizeTheorySupportState>;
type TheoryStateFileLike = ReturnType<typeof normalizeTheoryStateFile>;

type ManifestLike = {
  citation_integrity?: unknown;
  citation_collection?: unknown;
  theory_state?: unknown;
};

async function readProjectManifest(projectRoot: string): Promise<ManifestLike> {
  return (await readJsonIfExists<ManifestLike>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  )) ?? {};
}

export function isCitationCollectionHardFailure(
  state: CitationCollectionStateLike
): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return normalizeStage(state.status) === "blocked" || state.hallucinatedCount > 0;
}

export async function getCitationIntegrityStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: CitationIntegrityStateLike;
  bibliographyResolvedPath: string | null;
  bibliographyExists: boolean;
  verificationReportResolvedPath: string | null;
  verificationReportExists: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const state = normalizeCitationIntegrityState(manifest.citation_integrity);
  const bibliographyResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.bibliographyPath
  );
  const verificationReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.verificationReportPath
  );
  return {
    state,
    bibliographyResolvedPath,
    bibliographyExists: bibliographyResolvedPath
      ? await pathExists(bibliographyResolvedPath)
      : false,
    verificationReportResolvedPath,
    verificationReportExists: verificationReportResolvedPath
      ? await pathExists(verificationReportResolvedPath)
      : false,
  };
}

export async function getCitationCollectionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: CitationCollectionStateLike;
  progressResolvedPath: string | null;
  progressExists: boolean;
  cacheBibResolvedPath: string | null;
  cacheBibExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const state = normalizeCitationCollectionState(manifest.citation_collection);
  const progressResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.progressPath
  );
  const cacheBibResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.cacheBibPath
  );
  return {
    state,
    progressResolvedPath,
    progressExists: progressResolvedPath ? await pathExists(progressResolvedPath) : false,
    cacheBibResolvedPath,
    cacheBibExists: cacheBibResolvedPath ? await pathExists(cacheBibResolvedPath) : false,
    hardFailure: isCitationCollectionHardFailure(state),
  };
}

export async function getTheoryStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: TheorySupportStateLike;
  theoryStateResolvedPath: string | null;
  theoryStateExists: boolean;
  sourceTheoryNoteResolvedPath: string | null;
  sourceTheoryNoteExists: boolean;
  proofPacketDirResolvedPath: string | null;
  proofPacketCount: number;
  theoryFile: TheoryStateFileLike | null;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const state = normalizeTheorySupportState(manifest.theory_state);
  const theoryStateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.theoryStatePath
  );
  const sourceTheoryNoteResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.sourceTheoryNotePath
  );
  const proofPacketDirResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.proofPacketDir
  );
  const theoryStateExists = theoryStateResolvedPath
    ? await pathExists(theoryStateResolvedPath)
    : false;
  const sourceTheoryNoteExists = sourceTheoryNoteResolvedPath
    ? await pathExists(sourceTheoryNoteResolvedPath)
    : false;
  const theoryFile = theoryStateExists
    ? normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath))
    : null;
  let proofPacketCount = 0;
  if (proofPacketDirResolvedPath && (await pathExists(proofPacketDirResolvedPath))) {
    try {
      const entries = await fs.readdir(proofPacketDirResolvedPath);
      proofPacketCount = entries.filter((entry) => entry.endsWith(".json")).length;
    } catch {
      proofPacketCount = 0;
    }
  }
  return {
    state,
    theoryStateResolvedPath,
    theoryStateExists,
    sourceTheoryNoteResolvedPath,
    sourceTheoryNoteExists,
    proofPacketDirResolvedPath,
    proofPacketCount,
    theoryFile,
  };
}
