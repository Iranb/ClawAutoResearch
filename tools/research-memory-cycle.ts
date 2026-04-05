import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";

export const DEFAULT_IDE_CYCLE_MEMORY_PATH = "memory/IDE_CYCLE_MEMORY.json";
export const DEFAULT_IVE_CYCLE_MEMORY_PATH = "memory/IVE_CYCLE_MEMORY.json";
export const DEFAULT_ESE_CYCLE_MEMORY_PATH = "memory/ESE_CYCLE_MEMORY.json";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

function extractBulletLines(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .slice(0, 6);
}

function extractClaimSupportFindings(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /supported|partial|unsupported/i.test(line))
    .slice(0, 6);
}

export async function materializeCycleMemory(params: {
  projectRoot: string;
  stage: string | null;
  idePath?: string | null;
  ivePath?: string | null;
  esePath?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const [
    workingMemory,
    innovationReflection,
    trackRegistry,
    ideaToClaimMap,
    claimEvidenceMatrix,
    reviewReport,
    experimentMemory,
  ] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json")
    ),
    readTextIfExists(path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md")),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json")
    ),
    readTextIfExists(path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md")),
    readTextIfExists(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md")),
    readTextIfExists(path.join(projectRoot, "memory", "experiment-memory.md")),
  ]);

  const reviewerDir = path.join(projectRoot, "reviewer");
  let rebuttalText: string | null = null;
  try {
    const entries = await (await import("node:fs/promises")).readdir(reviewerDir);
    const rebuttalFile = entries
      .filter((entry) => /^rebuttal_.*\.md$/i.test(entry))
      .sort()
      .at(-1);
    if (rebuttalFile) {
      rebuttalText = await readTextIfExists(path.join(reviewerDir, rebuttalFile));
    }
  } catch {
    rebuttalText = null;
  }

  const tracks = asArray(trackRegistry?.tracks).map(asRecord).filter(Boolean);
  const topFragments = asArray(ideaToClaimMap?.top_fragments).map(asRecord).filter(Boolean);

  const ide = {
    status: "ready",
    stage: params.stage,
    generatedAt: new Date().toISOString(),
    survivingDirections: uniqueStrings([
      asString(workingMemory?.surviving_direction),
      ...topFragments.map((fragment) => asString(fragment?.title)),
      ...tracks.map((track) => asString(track?.hypothesis)),
    ]),
    doNotRepeat: uniqueStrings([
      ...asArray(workingMemory?.failed_directions).map((entry) => asString(entry)),
      ...extractBulletLines(innovationReflection),
    ]),
    transferablePatterns: uniqueStrings([
      ...topFragments.map((fragment) => asString(fragment?.title)),
      ...tracks.map((track) => asString(track?.novelty_basis)),
      ...extractBulletLines(innovationReflection),
    ]),
    sourcePaths: [
      "researcher/brainstorm-cycle/WORKING_MEMORY.json",
      "researcher/INNOVATION_REFLECTION.md",
      "TRACK_REGISTRY.json",
      "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
    ],
  };

  const ive = {
    status: "ready",
    stage: params.stage,
    generatedAt: new Date().toISOString(),
    claimSupportFindings: uniqueStrings([
      ...extractClaimSupportFindings(claimEvidenceMatrix),
      ...extractBulletLines(experimentMemory),
    ]),
    experimentLessons: uniqueStrings(extractBulletLines(experimentMemory)),
    evolutionSummary: uniqueStrings([
      "Prefer experiment-isolated gains over broad prose claims.",
      ...extractBulletLines(reviewReport),
    ]),
    sourcePaths: [
      "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      "memory/experiment-memory.md",
      "reviewer/REVIEW_REPORT.md",
    ],
  };

  const ese = {
    status: "ready",
    stage: params.stage,
    generatedAt: new Date().toISOString(),
    reviewPressurePatterns: uniqueStrings(extractBulletLines(reviewReport)),
    rebuttalStrategies: uniqueStrings(
      (rebuttalText ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /Strategy:/i.test(line))
        .map((line) => line.replace(/^[-*]\s*/, ""))
    ),
    writingAdjustments: uniqueStrings([
      "Narrow claims before polishing prose.",
      ...extractBulletLines(rebuttalText),
      ...extractBulletLines(reviewReport),
    ]),
    sourcePaths: ["reviewer/REVIEW_REPORT.md", "reviewer/rebuttal_{date}.md"],
  };

  const ideResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    params.idePath ?? DEFAULT_IDE_CYCLE_MEMORY_PATH
  );
  const iveResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    params.ivePath ?? DEFAULT_IVE_CYCLE_MEMORY_PATH
  );
  const eseResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    params.esePath ?? DEFAULT_ESE_CYCLE_MEMORY_PATH
  );
  if (!ideResolvedPath || !iveResolvedPath || !eseResolvedPath) {
    throw new Error("Unable to resolve cycle-memory output paths.");
  }

  await Promise.all([
    writeJsonEnsured(ideResolvedPath, ide),
    writeJsonEnsured(iveResolvedPath, ive),
    writeJsonEnsured(eseResolvedPath, ese),
  ]);

  return {
    ide,
    ive,
    ese,
    generatedFiles: [
      params.idePath ?? DEFAULT_IDE_CYCLE_MEMORY_PATH,
      params.ivePath ?? DEFAULT_IVE_CYCLE_MEMORY_PATH,
      params.esePath ?? DEFAULT_ESE_CYCLE_MEMORY_PATH,
    ],
  };
}
