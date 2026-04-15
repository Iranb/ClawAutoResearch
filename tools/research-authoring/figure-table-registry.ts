import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { nowIso, projectPathExists, writeProjectJson } from "../research-contracts/core/project-io";

type RegistryEntry = {
  id: string;
  kind: "figure" | "table";
  file: string;
  captionPresent: boolean;
  caption: string | null;
  role: "framework" | "experiment" | "ablation" | "comparison" | "analysis" | "unknown";
};

async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: Dirent[] = [];
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

function findCaptionNearLabel(text: string, labelIndex: number): string | null {
  const windowStart = Math.max(0, labelIndex - 1600);
  const windowEnd = Math.min(text.length, labelIndex + 1600);
  const localText = text.slice(windowStart, windowEnd);
  const captions = Array.from(localText.matchAll(/\\caption(?:\[[^\]]*\])?\{([^}]+)\}/g));
  const caption = captions.at(-1)?.[1] ?? captions[0]?.[1] ?? null;
  return caption ? caption.replace(/\s+/g, " ").trim() : null;
}

function classifyEntry(params: {
  id: string;
  kind: "figure" | "table";
  caption: string | null;
  filePath: string;
}): RegistryEntry["role"] {
  const text = `${params.id} ${params.caption ?? ""} ${params.filePath}`.toLowerCase();
  if (/\b(framework|overview|architecture|pipeline|method|workflow|system)\b/.test(text)) {
    return "framework";
  }
  if (/\b(ablation|component|without|minus|sensitivity)\b/.test(text)) {
    return "ablation";
  }
  if (/\b(experiment|result|metric|benchmark|dataset|accuracy|h-score|f1|map|auc|score)\b/.test(text)) {
    return "experiment";
  }
  if (/\b(compare|comparison|sota|baseline|state[- ]of[- ]the[- ]art)\b/.test(text)) {
    return "comparison";
  }
  if (/\b(analysis|case|failure|qualitative|visualization)\b/.test(text)) {
    return "analysis";
  }
  return "unknown";
}

function scanEntries(projectRoot: string, filePath: string, text: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const figureLabels = Array.from(text.matchAll(/\\label\{(fig:[^}]+)\}/g));
  const tableLabels = Array.from(text.matchAll(/\\label\{(tab:[^}]+)\}/g));
  for (const match of figureLabels) {
    const caption = findCaptionNearLabel(text, match.index ?? 0);
    entries.push({
      id: match[1],
      kind: "figure",
      file: relative(projectRoot, filePath),
      captionPresent: Boolean(caption),
      caption,
      role: classifyEntry({
        id: match[1],
        kind: "figure",
        caption,
        filePath,
      }),
    });
  }
  for (const match of tableLabels) {
    const caption = findCaptionNearLabel(text, match.index ?? 0);
    entries.push({
      id: match[1],
      kind: "table",
      file: relative(projectRoot, filePath),
      captionPresent: Boolean(caption),
      caption,
      role: classifyEntry({
        id: match[1],
        kind: "table",
        caption,
        filePath,
      }),
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
  const frameworkFigures = figures.filter((entry) => entry.role === "framework");
  const experimentTables = tables.filter((entry) =>
    ["experiment", "ablation", "comparison"].includes(entry.role)
  );
  const outputDir = params.outputDir ?? "academic_writer";
  const alignmentPath = `${outputDir}/FIGURE_TABLE_ALIGNMENT.md`;
  await writeProjectJson(params.projectRoot, `${outputDir}/FIGURE_REGISTRY.json`, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: figures,
    totalFigureCount: figures.length,
    frameworkFigureCount: frameworkFigures.length,
    unresolvedPlaceholderCount: unresolvedFigurePlaceholders,
  });
  await writeProjectJson(params.projectRoot, `${outputDir}/TABLE_REGISTRY.json`, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: tables,
    totalTableCount: tables.length,
    experimentTableCount: experimentTables.length,
    unresolvedPlaceholderCount: unresolvedTablePlaceholders,
  });
  await fs.mkdir(path.join(params.projectRoot, outputDir), { recursive: true });
  await fs.writeFile(
    path.join(params.projectRoot, alignmentPath),
    [
      "# Figure/Table Alignment Contract",
      "",
      "## Required minimums",
      "- Write handoff: at least 1 framework figure and 2 experiment/result tables.",
      "- Final submit: at least 5 figures and 4 tables.",
      "",
      "## Current counts",
      `- Figures: ${figures.length}`,
      `- Framework figures: ${frameworkFigures.length}`,
      `- Tables: ${tables.length}`,
      `- Experiment/result tables: ${experimentTables.length}`,
      `- Unresolved figure placeholders: ${unresolvedFigurePlaceholders}`,
      `- Unresolved table placeholders: ${unresolvedTablePlaceholders}`,
      "",
      "## Writer/Coder/Reviewer alignment rule",
      "- Writer owns placement, captions, and narrative references.",
      "- Coder owns experiment/result table provenance and regenerability from durable experiment artifacts.",
      "- Reviewer owns consistency between captions, table claims, and review evidence.",
      "",
      "## Registered figures",
      ...(figures.length > 0
        ? figures.map((entry) => `- ${entry.id} (${entry.role}) ${entry.caption ?? "caption missing"}`)
        : ["- none"]),
      "",
      "## Registered tables",
      ...(tables.length > 0
        ? tables.map((entry) => `- ${entry.id} (${entry.role}) ${entry.caption ?? "caption missing"}`)
        : ["- none"]),
      "",
    ].join("\n"),
    "utf8"
  );
  return {
    figureRegistryPath: `${outputDir}/FIGURE_REGISTRY.json`,
    tableRegistryPath: `${outputDir}/TABLE_REGISTRY.json`,
    alignmentPath,
    figures,
    tables,
    frameworkFigures,
    experimentTables,
    unresolvedFigurePlaceholders,
    unresolvedTablePlaceholders,
  };
}
