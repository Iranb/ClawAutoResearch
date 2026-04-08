import path from "node:path";

export const DEFAULT_SHARED_PAPERNEXUS_CORPUS = "shared-global-graph";

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slugCorpusKey(value: string | null | undefined): string | null {
  const raw = asOptionalString(value);
  if (!raw) {
    return null;
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

export function isProjectScopedPapernexusCorpus(params: {
  corpusName: string | null | undefined;
  projectId?: string | null | undefined;
  projectRoot?: string | null | undefined;
}): boolean {
  const candidate = slugCorpusKey(params.corpusName);
  if (!candidate) {
    return false;
  }
  const projectCandidates = [
    params.projectId,
    params.projectRoot ? path.basename(path.resolve(params.projectRoot)) : null,
  ]
    .map((value) => slugCorpusKey(value))
    .filter((value): value is string => Boolean(value));
  return projectCandidates.includes(candidate);
}

export function resolveWorkflowSharedPapernexusCorpus(params: {
  candidates?: unknown[];
  projectId?: string | null | undefined;
  projectRoot?: string | null | undefined;
  fallback?: string | null | undefined;
}): string | null {
  for (const candidate of params.candidates ?? []) {
    const value = asOptionalString(candidate);
    if (!value) {
      continue;
    }
    if (
      isProjectScopedPapernexusCorpus({
        corpusName: value,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
      })
    ) {
      continue;
    }
    return value;
  }
  return asOptionalString(params.fallback);
}
