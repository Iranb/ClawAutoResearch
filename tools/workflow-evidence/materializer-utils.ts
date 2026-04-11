import path from "node:path";
import { readJsonIfExists, writeJsonAtomicEnsured } from "../workflow-guard-core/fs";

export async function readProjectManifest(projectRoot: string): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {}
  );
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await writeJsonAtomicEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
