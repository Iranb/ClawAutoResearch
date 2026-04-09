import path from "node:path";

export type ResolveProjectsRootOptions = {
  cliProjectsRoot?: string | null | undefined;
  envProjectsRoot?: string | null | undefined;
};

function normalizeProjectsRoot(input: string | null | undefined): string | undefined {
  const trimmed = input?.trim();

  if (!trimmed) {
    return undefined;
  }

  return path.resolve(trimmed);
}

export function resolveProjectsRoot(
  options: ResolveProjectsRootOptions = {},
): string {
  const explicitProjectsRoot = normalizeProjectsRoot(options.cliProjectsRoot);

  if (explicitProjectsRoot) {
    return explicitProjectsRoot;
  }

  const envProjectsRoot = normalizeProjectsRoot(
    options.envProjectsRoot ?? process.env.OPENCLAW_PROJECTS_ROOT,
  );

  if (envProjectsRoot) {
    return envProjectsRoot;
  }

  throw new Error(
    "Missing projectsRoot configuration. Pass --projectsRoot <path> or set OPENCLAW_PROJECTS_ROOT.",
  );
}
