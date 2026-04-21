import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { WorkflowPaperSourceEntry } from "../paper-source-index";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function looksReadableTextPath(value: string): boolean {
  return /\.(md|markdown|txt)$/i.test(value);
}

function deriveCompanionMarkdownPaths(sourcePath: string): string[] {
  const resolved = path.resolve(sourcePath);
  const extension = path.extname(resolved);
  const basename = path.basename(resolved, extension);
  const dirname = path.dirname(resolved);
  return uniqueStrings([
    extension ? resolved.slice(0, -extension.length) + ".md" : null,
    path.join(dirname, `${basename}.md`),
    path.join(dirname, "md", `${basename}.md`),
    path.join(dirname, "..", "md", `${basename}.md`),
  ]);
}

function stripFrontMatter(value: string): string {
  if (!value.startsWith("---\n")) {
    return value;
  }
  const end = value.indexOf("\n---\n", 4);
  if (end < 0) {
    return value;
  }
  return value.slice(end + 5);
}

function normalizeMarkdownBody(value: string): string {
  return stripFrontMatter(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function firstExistingTextPath(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function readPaperBodyText(params: {
  entry: WorkflowPaperSourceEntry;
  maxChars?: number;
}): Promise<{
  text: string | null;
  sourcePath: string | null;
  sourceKind: "markdown" | "unavailable";
}> {
  const maxChars = Math.max(2000, Math.floor(params.maxChars ?? 80_000));
  const candidatePaths = uniqueStrings([
    params.entry.sourcePath && looksReadableTextPath(params.entry.sourcePath)
      ? path.resolve(params.entry.sourcePath)
      : null,
    ...params.entry.sourceHints
      .filter((hint) => looksReadableTextPath(hint))
      .map((hint) => path.resolve(hint)),
    ...(params.entry.sourcePath ? deriveCompanionMarkdownPaths(params.entry.sourcePath) : []),
  ]);
  const readablePath = await firstExistingTextPath(candidatePaths);
  if (!readablePath) {
    return {
      text: null,
      sourcePath: null,
      sourceKind: "unavailable",
    };
  }
  const raw = await fs.readFile(readablePath, "utf8");
  const normalized = normalizeMarkdownBody(raw).slice(0, maxChars).trim();
  return {
    text: normalized || null,
    sourcePath: readablePath,
    sourceKind: normalized ? "markdown" : "unavailable",
  };
}
