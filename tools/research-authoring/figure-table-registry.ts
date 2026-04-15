import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, projectPathExists, writeProjectJson } from "../research-contracts/core/project-io.ts";

type RegistryEntry = {
  id: string;
  kind: "figure" | "table";
  file: string;
  captionPresent: boolean;
};

async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
        continue;
      }
      if (/\.(tex|md|txt)$/i.test(entry.name)) {
        results.push(resolved);
      }
    }
  }
  await walk(root);
  return results;
}

function relative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

function scanEntries(projectRoot: string, filePath: string, text: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const figureLabels = Array.from(text.matchAll(/\\label\{(fig:[^}]+)\}/g));
  const tableLabels = Array.from(text.matchAll(/\\label\{(tab:[^}]+)\}/g));
  for (const match of figureLabels) {
    entries.push({
      id: match[1],
      kind: "figure",
      file: relative(projectRoot, filePath),
      captionPresent: /\\caption\{[^}]+\}/.test(text),
    });
  }
  for (const match of tableLabels) {
    entries.push({
      id: match[1],
      kind: "table",
      file: relative(projectRoot, filePath),
      captionPresent: /\\caption\{[^}]+\}/.test(text),
    });
  }
  return entries;
}

export async function materializeFigureTableRegistry(params: {
  projectRoot: string;
  outputDir?: string;
}) {
  const authoringRoot = path.join(params.projectRoot, "academic_writer");
  const exists = await projectPathExists(params.projectRoot, "academic_writer");
  const entries: RegistryEntry[] = [];
  let unresolvedFigurePlaceholders = 0;
  let unresolvedTablePlaceholders = 0;
  if (exists) {
    const files = await collectFiles(authoringRoot);
    for (const filePath of files) {
      const text = await fs.readFile(filePath, "utf8");
      entries.push(...scanEntries(params.projectRoot, filePath, text));
      unresolvedFigurePlaceholders += (text.match(/Figure\??\s*\?\?/g) ?? []).length;
      unresolvedTablePlaceholders += (text.match(/Table\??\s*\?\?/g) ?? []).length;
    }
  }
  const figures = entries.filter((entry) => entry.kind === "figure");
  const tables = entries.filter((entry) => entry.kind === "table");
  const outputDir = params.outputDir ?? "academic_writer";
  await writeProjectJson(params.projectRoot, `${outputDir}/FIGURE_REGISTRY.json`, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: figures,
    unresolvedPlaceholderCount: unresolvedFigurePlaceholders,
  });
  await writeProjectJson(params.projectRoot, `${outputDir}/TABLE_REGISTRY.json`, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: tables,
    unresolvedPlaceholderCount: unresolvedTablePlaceholders,
  });
  return {
    figureRegistryPath: `${outputDir}/FIGURE_REGISTRY.json`,
    tableRegistryPath: `${outputDir}/TABLE_REGISTRY.json`,
    figures,
    tables,
    unresolvedFigurePlaceholders,
    unresolvedTablePlaceholders,
  };
}
