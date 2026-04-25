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

export function isLegacyDefaultPapernexusCorpus(value: unknown): boolean {
  return asOptionalString(value) === DEFAULT_SHARED_PAPERNEXUS_CORPUS;
}

export function hasRemotePapernexusEndpoint(params: {
  mcpUrl?: unknown;
  apiBaseUrl?: unknown;
}): boolean {
  return Boolean(asOptionalString(params.mcpUrl) ?? asOptionalString(params.apiBaseUrl));
}

export function shouldAutodiscoverRemotePapernexusCorpus(params: {
  mcpUrl?: unknown;
  apiBaseUrl?: unknown;
  configuredSharedCorpus?: unknown;
}): boolean {
  return (
    hasRemotePapernexusEndpoint(params) &&
    !asOptionalString(params.configuredSharedCorpus)
  );
}

export function resolvePapernexusSharedCorpusFallback(params: {
  mcpUrl?: unknown;
  apiBaseUrl?: unknown;
  configuredSharedCorpus?: unknown;
  fallback?: string | null | undefined;
}): string | null {
  const configured = asOptionalString(params.configuredSharedCorpus);
  if (configured) {
    return configured;
  }
  if (hasRemotePapernexusEndpoint(params)) {
    return null;
  }
  return asOptionalString(params.fallback ?? DEFAULT_SHARED_PAPERNEXUS_CORPUS);
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
  ignoreLegacyDefault?: boolean;
}): string | null {
  for (const candidate of params.candidates ?? []) {
    const value = asOptionalString(candidate);
    if (!value) {
      continue;
    }
    if (params.ignoreLegacyDefault && isLegacyDefaultPapernexusCorpus(value)) {
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
