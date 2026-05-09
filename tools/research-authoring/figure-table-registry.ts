import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { nowIso, projectPathExists, writeProjectJson } from "../research-contracts/core/project-io";

type RegistryEntry = {
  id: string;
  kind: "figure" | "table";
  file: string;
  labelLine: number;
  captionPresent: boolean;
  caption: string | null;
  citationKeys: string[];
  role: "framework" | "experiment" | "ablation" | "comparison" | "analysis" | "unknown";
};

type ProvenanceEntry = RegistryEntry & {
  sourceArtifacts: string[];
  evidenceCardIds: string[];
  provenanceStatus: "supported" | "partial" | "blocked";
  provenanceIssues: string[];
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
  const beforeLabel = text.slice(windowStart, labelIndex);
  const afterLabel = text.slice(labelIndex, windowEnd);
  const captionsBefore = Array.from(
    beforeLabel.matchAll(/\\caption(?:\[[^\]]*\])?\{([^}]+)\}/g)
  );
  const captionsAfter = Array.from(
    afterLabel.matchAll(/\\caption(?:\[[^\]]*\])?\{([^}]+)\}/g)
  );
  const caption = captionsBefore.at(-1)?.[1] ?? captionsAfter[0]?.[1] ?? null;
  return caption ? caption.replace(/\s+/g, " ").trim() : null;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function textWindowNearLabel(text: string, labelIndex: number): string {
  const figureBegin = text.lastIndexOf("\\begin{figure}", labelIndex);
  const tableBegin = text.lastIndexOf("\\begin{table}", labelIndex);
  const blockStart = Math.max(figureBegin, tableBegin);
  if (blockStart >= 0) {
    const figureEnd = text.indexOf("\\end{figure}", labelIndex);
    const tableEnd = text.indexOf("\\end{table}", labelIndex);
    const blockEndCandidates = [figureEnd, tableEnd].filter((index) => index >= 0);
    const blockEnd = Math.min(...blockEndCandidates);
    if (Number.isFinite(blockEnd) && blockEnd >= labelIndex) {
      return text.slice(blockStart, blockEnd + "\\end{figure}".length);
    }
  }
  const windowStart = Math.max(0, labelIndex - 2200);
  const windowEnd = Math.min(text.length, labelIndex + 2200);
  return text.slice(windowStart, windowEnd);
}

function parseCitationKeys(text: string): string[] {
  const keys = new Set<string>();
  const pattern =
    /\\(?:cite|citep|citet|citealp|citeauthor|parencite|textcite)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    for (const key of match[1].split(",")) {
      const trimmed = key.trim();
      if (trimmed) {
        keys.add(trimmed);
      }
    }
  }
  return [...keys].sort();
}

function classifyEntry(params: {
  id: string;
  kind: "figure" | "table";
  caption: string | null;
  filePath: string;
}): RegistryEntry["role"] {
  const text = `${params.id} ${params.caption ?? ""} ${params.filePath}`.toLowerCase();
  const isFramework = /\b(framework|overview|architecture|pipeline|method|workflow|system)\b/.test(text);
  const isAblation = /\b(ablation|component|without|minus|sensitivity)\b/.test(text);
  const isExperiment = /\b(experiment|result|metric|benchmark|dataset|accuracy|h-score|f1|map|auc|score)\b/.test(text);
  const isComparison = /\b(compare|compares|comparing|comparison|sota|baseline|state[- ]of[- ]the[- ]art)\b/.test(text);
  const isAnalysis = /\b(analysis|case|failure|qualitative|visualization)\b/.test(text);
  if (params.kind === "table") {
    if (isAblation) {
      return "ablation";
    }
    if (isExperiment) {
      return "experiment";
    }
    if (isComparison) {
      return "comparison";
    }
    if (isAnalysis) {
      return "analysis";
    }
    if (isFramework) {
      return "framework";
    }
    return "unknown";
  }
  if (isFramework) {
    return "framework";
  }
  if (isAblation) {
    return "ablation";
  }
  if (isExperiment) {
    return "experiment";
  }
  if (isComparison) {
    return "comparison";
  }
  if (isAnalysis) {
    return "analysis";
  }
  return "unknown";
}

function scanEntries(projectRoot: string, filePath: string, text: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const figureLabels = Array.from(text.matchAll(/\\label\{(fig:[^}]+)\}/g));
  const tableLabels = Array.from(text.matchAll(/\\label\{(tab:[^}]+)\}/g));
  for (const match of figureLabels) {
    const labelIndex = match.index ?? 0;
    const caption = findCaptionNearLabel(text, labelIndex);
    entries.push({
      id: match[1],
      kind: "figure",
      file: relative(projectRoot, filePath),
      labelLine: lineNumberAt(text, labelIndex),
      captionPresent: Boolean(caption),
      caption,
      citationKeys: parseCitationKeys(textWindowNearLabel(text, labelIndex)),
      role: classifyEntry({
        id: match[1],
        kind: "figure",
        caption,
        filePath,
      }),
    });
  }
  for (const match of tableLabels) {
    const labelIndex = match.index ?? 0;
    const caption = findCaptionNearLabel(text, labelIndex);
    entries.push({
      id: match[1],
      kind: "table",
      file: relative(projectRoot, filePath),
      labelLine: lineNumberAt(text, labelIndex),
      captionPresent: Boolean(caption),
      caption,
      citationKeys: parseCitationKeys(textWindowNearLabel(text, labelIndex)),
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

async function existingProjectArtifacts(
  projectRoot: string,
  candidates: string[]
): Promise<string[]> {
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await projectPathExists(projectRoot, candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

function buildProvenanceEntry(params: {
  entry: RegistryEntry;
  evidenceArtifacts: string[];
}): ProvenanceEntry {
  const sourceArtifacts = [
    params.entry.file,
    ...params.entry.citationKeys.map((key) => `citation:${key}`),
  ];
  if (["experiment", "ablation", "comparison", "analysis"].includes(params.entry.role)) {
    sourceArtifacts.push(...params.evidenceArtifacts);
  }
  const evidenceCardIds = [
    `${params.entry.kind}:${params.entry.id}`,
    ...params.entry.citationKeys.map((key) => `citation:${key}`),
    ...params.evidenceArtifacts.map((artifact) => `artifact:${artifact}`),
  ];
  const provenanceIssues: string[] = [];
  if (!params.entry.captionPresent) {
    provenanceIssues.push("caption_missing");
  }
  if (params.entry.citationKeys.length === 0 && params.evidenceArtifacts.length === 0) {
    provenanceIssues.push("source_evidence_missing");
  }
  const provenanceStatus =
    provenanceIssues.length === 0
      ? "supported"
      : sourceArtifacts.length > 1 || params.entry.captionPresent
        ? "partial"
        : "blocked";
  return {
    ...params.entry,
    sourceArtifacts: [...new Set(sourceArtifacts)],
    evidenceCardIds: [...new Set(evidenceCardIds)],
    provenanceStatus,
    provenanceIssues,
  };
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
  const evidenceArtifacts = await existingProjectArtifacts(params.projectRoot, [
    "analyzer/CLAIM_EVIDENCE_MATRIX.md",
    "analyzer/TRACK_VERDICTS.md",
    "analyzer/results/main_table.json",
    "researcher/EXPERIMENT_LEDGER.json",
    "researcher/SOTA_MATRIX.md",
    "researcher/SURVEY_BRIEF.md",
    "researcher/LITERATURE_REVIEW.md",
    "researcher/GAP_SYNTHESIS.md",
    "researcher/COVERAGE_SUMMARY.md",
  ]);
  const provenanceEntries = entries.map((entry) =>
    buildProvenanceEntry({ entry, evidenceArtifacts })
  );
  const blockedProvenance = provenanceEntries.filter(
    (entry) => entry.provenanceStatus === "blocked"
  );
  const partialProvenance = provenanceEntries.filter(
    (entry) => entry.provenanceStatus === "partial"
  );
  const outputDir = params.outputDir ?? "academic_writer";
  const alignmentPath = `${outputDir}/FIGURE_TABLE_ALIGNMENT.md`;
  const provenancePath = `${outputDir}/FIGURE_TABLE_PROVENANCE.json`;
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
  await writeProjectJson(params.projectRoot, provenancePath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: provenanceEntries,
    evidenceArtifacts,
    summary: {
      totalArtifactCount: provenanceEntries.length,
      supportedCount: provenanceEntries.filter(
        (entry) => entry.provenanceStatus === "supported"
      ).length,
      partialCount: partialProvenance.length,
      blockedCount: blockedProvenance.length,
      blockingIssues: blockedProvenance.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        file: entry.file,
        issues: entry.provenanceIssues,
      })),
    },
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
      `- Provenance supported: ${
        provenanceEntries.filter((entry) => entry.provenanceStatus === "supported").length
      }`,
      `- Provenance partial: ${partialProvenance.length}`,
      `- Provenance blocked: ${blockedProvenance.length}`,
      "",
      "## Writer/Coder/Reviewer alignment rule",
      "- Writer owns placement, captions, and narrative references.",
      "- Coder owns experiment/result table provenance and regenerability from durable experiment artifacts.",
      "- Reviewer owns consistency between captions, table claims, and review evidence.",
      "- Every figure/table must keep a provenance entry tying the label, caption, citation keys, and source artifacts together.",
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
      "## Provenance blockers",
      ...(blockedProvenance.length > 0
        ? blockedProvenance.map(
            (entry) => `- ${entry.id}: ${entry.provenanceIssues.join(", ")}`
          )
        : ["- none"]),
      "",
    ].join("\n"),
    "utf8"
  );
  return {
    figureRegistryPath: `${outputDir}/FIGURE_REGISTRY.json`,
    tableRegistryPath: `${outputDir}/TABLE_REGISTRY.json`,
    alignmentPath,
    provenancePath,
    figures,
    tables,
    provenanceEntries,
    frameworkFigures,
    experimentTables,
    unresolvedFigurePlaceholders,
    unresolvedTablePlaceholders,
  };
}
