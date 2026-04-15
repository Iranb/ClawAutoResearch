import path from "node:path";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonAtomicEnsured,
  writeTextEnsured,
} from "../../workflow-guard-core/fs";

export function nowIso(): string {
  return new Date().toISOString();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function projectManifestPath(projectRoot: string): string {
  return path.join(projectRoot, "PROJECT_MANIFEST.json");
}

export async function readProjectManifest(
  projectRoot: string
): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(projectManifestPath(projectRoot))) ?? {}
  );
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await writeJsonAtomicEnsured(projectManifestPath(projectRoot), manifest);
}

export async function readProjectJson<T>(
  projectRoot: string,
  relativePath: string | null | undefined
): Promise<T | null> {
  if (!relativePath) {
    return null;
  }
  return readJsonIfExists<T>(path.join(projectRoot, relativePath));
}

export async function readProjectText(
  projectRoot: string,
  relativePath: string | null | undefined
): Promise<string | null> {
  if (!relativePath) {
    return null;
  }
  return readTextIfExists(path.join(projectRoot, relativePath));
}

export async function writeProjectJson(
  projectRoot: string,
  relativePath: string,
  value: unknown
): Promise<string> {
  const targetPath = path.join(projectRoot, relativePath);
  await writeJsonAtomicEnsured(targetPath, value);
  return targetPath;
}

export async function writeProjectText(
  projectRoot: string,
  relativePath: string,
  value: string
): Promise<string> {
  const targetPath = path.join(projectRoot, relativePath);
  await writeTextEnsured(targetPath, value);
  return targetPath;
}

export async function projectPathExists(
  projectRoot: string,
  relativePath: string | null | undefined
): Promise<boolean> {
  if (!relativePath) {
    return false;
  }
  return pathExists(path.join(projectRoot, relativePath));
}

export function normalizeRelativePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\\/g, "/");
}
