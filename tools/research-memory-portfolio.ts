import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";

export const DEFAULT_PORTFOLIO_CYCLE_MEMORY_PATH = "memory/PORTFOLIO_CYCLE_MEMORY.json";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

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

async function readProjectMemory(projectRoot: string) {
  const [manifest, ide, ive, ese] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "memory", "IDE_CYCLE_MEMORY.json")),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "memory", "IVE_CYCLE_MEMORY.json")),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "memory", "ESE_CYCLE_MEMORY.json")),
  ]);
  if (!manifest && !ide && !ive && !ese) {
    return null;
  }
  return {
    projectId:
      asString(manifest?.project_id) ??
      asString(manifest?.projectId) ??
      path.basename(projectRoot),
    ide,
    ive,
    ese,
  };
}

export async function materializePortfolioCycleMemory(params: {
  projectRoot: string;
  artifactPath?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const projectsRoot = path.dirname(projectRoot);
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const candidateRoots = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsRoot, entry.name));
  const loaded = (
    await Promise.all(candidateRoots.map(readProjectMemory))
  ).filter((entry): entry is NonNullable<Awaited<ReturnType<typeof readProjectMemory>>> =>
    Boolean(entry)
  );

  const payload = {
    status: "ready",
    generatedAt: new Date().toISOString(),
    projectsConsidered: loaded.length,
    project_ids: loaded.map((entry) => entry.projectId),
    transferablePatterns: uniqueStrings(
      loaded.flatMap((entry) =>
        asArray(entry.ide?.transferablePatterns).map((item) => asString(item))
      )
    ).slice(0, 12),
    doNotRepeat: uniqueStrings(
      loaded.flatMap((entry) => asArray(entry.ide?.doNotRepeat).map((item) => asString(item)))
    ).slice(0, 12),
    claimSupportPatterns: uniqueStrings(
      loaded.flatMap((entry) =>
        asArray(entry.ive?.claimSupportFindings).map((item) => asString(item))
      )
    ).slice(0, 12),
    experimentLessons: uniqueStrings(
      loaded.flatMap((entry) =>
        asArray(entry.ive?.experimentLessons).map((item) => asString(item))
      )
    ).slice(0, 12),
    reviewPressurePatterns: uniqueStrings(
      loaded.flatMap((entry) =>
        asArray(entry.ese?.reviewPressurePatterns).map((item) => asString(item))
      )
    ).slice(0, 12),
    rebuttalStrategies: uniqueStrings(
      loaded.flatMap((entry) =>
        asArray(entry.ese?.rebuttalStrategies).map((item) => asString(item))
      )
    ).slice(0, 12),
  };

  const artifactPath = params.artifactPath ?? DEFAULT_PORTFOLIO_CYCLE_MEMORY_PATH;
  await writeJsonEnsured(path.join(projectRoot, artifactPath), payload);
  return {
    ...payload,
    path: artifactPath,
  };
}
