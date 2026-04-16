import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ResolveProjectsRootOptions = {
  cliProjectsRoot?: string | null | undefined;
  envProjectsRoot?: string | null | undefined;
  configPath?: string | null | undefined;
  profile?: string | null | undefined;
};

function normalizeProjectsRoot(input: string | null | undefined): string | undefined {
  const trimmed = input?.trim();

  if (!trimmed) {
    return undefined;
  }

  return path.resolve(trimmed);
}

function resolveDefaultConfigPath(profile?: string | null): string {
  const explicitConfigPath = normalizeProjectsRoot(
    process.env.OPENCLAW_CONFIG_PATH,
  );
  if (explicitConfigPath) {
    return explicitConfigPath;
  }
  const resolvedProfile = (profile ?? process.env.OPENCLAW_PROFILE ?? "default").trim();
  if (resolvedProfile === "dev") {
    return path.join(os.homedir(), ".openclaw-dev", "openclaw.json");
  }
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function readProjectsRootFromPluginConfig(configPath: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const plugins = (raw.plugins ?? {}) as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;
    const clawAutoResearch = entries.ClawAutoResearch as Record<string, unknown> | undefined;
    const legacyOpenclawResearch = entries["openclaw-research"] as
      | Record<string, unknown>
      | undefined;
    const config =
      (clawAutoResearch?.config as Record<string, unknown> | undefined) ??
      (legacyOpenclawResearch?.config as Record<string, unknown> | undefined) ??
      {};
    return normalizeProjectsRoot(
      (config.projectsRoot as string | undefined) ?? undefined,
    );
  } catch {
    return undefined;
  }
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

  const configPath =
    normalizeProjectsRoot(options.configPath) ??
    resolveDefaultConfigPath(options.profile);
  const configProjectsRoot = readProjectsRootFromPluginConfig(configPath);
  if (configProjectsRoot) {
    return configProjectsRoot;
  }

  return path.resolve(os.homedir(), ".openclaw", "projects");
}
