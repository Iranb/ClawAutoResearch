import * as fs from "node:fs/promises";
import * as path from "node:path";

import { withAdvisoryLock } from "./workflow-guard-core/fs";

function archivePathFor(activeLogPath: string, index: number): string {
  if (activeLogPath.endsWith(".jsonl")) {
    return activeLogPath.replace(/\.jsonl$/, `.${Math.max(1, Math.floor(index))}.jsonl`);
  }
  return `${activeLogPath}.${Math.max(1, Math.floor(index))}`;
}

async function getExistingFileSize(targetPath: string): Promise<number> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.size;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export async function appendRotatingJsonlLine(params: {
  activeLogPath: string;
  serializedLine: string;
  lockPath?: string | null;
  maxBytes: number;
  maxArchives: number;
}): Promise<{ rotated: boolean; archivedPath: string | null }> {
  const activeLogPath = path.resolve(params.activeLogPath);
  const lockPath =
    params.lockPath?.trim() ||
    path.join(path.dirname(activeLogPath), `${path.basename(activeLogPath)}.lock`);
  return withAdvisoryLock({
    lockPath,
    task: async () => {
      await fs.mkdir(path.dirname(activeLogPath), { recursive: true });
      const existingSize = await getExistingFileSize(activeLogPath);
      let rotated = false;
      let archivedPath: string | null = null;
      if (
        existingSize > 0 &&
        existingSize + Buffer.byteLength(params.serializedLine, "utf8") > params.maxBytes
      ) {
        const oldestArchivePath = archivePathFor(activeLogPath, params.maxArchives);
        await fs.rm(oldestArchivePath, { force: true });
        for (let index = params.maxArchives - 1; index >= 1; index -= 1) {
          const sourcePath = archivePathFor(activeLogPath, index);
          const targetPath = archivePathFor(activeLogPath, index + 1);
          try {
            await fs.rename(sourcePath, targetPath);
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : null;
            if (code !== "ENOENT") {
              throw error;
            }
          }
        }
        archivedPath = archivePathFor(activeLogPath, 1);
        await fs.rename(activeLogPath, archivedPath);
        rotated = true;
      }
      await fs.appendFile(activeLogPath, params.serializedLine, "utf8");
      return { rotated, archivedPath };
    },
  });
}

export async function readRotatingJsonlTail(params: {
  activeLogPath: string;
  maxArchives: number;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  const activeLogPath = path.resolve(params.activeLogPath);
  const allLines: string[] = [];
  let exists = false;
  const archivePaths = Array.from({ length: params.maxArchives }, (_, offset) =>
    archivePathFor(activeLogPath, params.maxArchives - offset)
  );
  for (const targetPath of [...archivePaths, activeLogPath]) {
    try {
      const raw = await fs.readFile(targetPath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        exists = true;
        allLines.push(...lines);
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
  return {
    exists,
    lineCount: allLines.length,
    tail: allLines.slice(-Math.max(1, Math.floor(params.tailLines))),
  };
}
