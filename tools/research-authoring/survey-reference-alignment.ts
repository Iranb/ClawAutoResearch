import * as path from "node:path";

import { readJsonIfExists, readTextIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";

export const DEFAULT_SURVEY_REFERENCE_ALIGNMENT_PATH =
  "researcher/SURVEY_REFERENCE_ALIGNMENT.json";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBibEntries(source: string | null): Array<{
  key: string;
  title: string | null;
  year: number | null;
}> {
  if (!source) {
    return [];
  }
  const entries: Array<{ key: string; title: string | null; year: number | null }> = [];
  const blocks = source.split(/@/g).filter(Boolean);
  for (const block of blocks) {
    const body = `@${block}`;
    const keyMatch = body.match(/@\w+\s*[{(]\s*([^,\s]+)/);
    const titleMatch = body.match(/\btitle\s*=\s*[{"]([^}"]+)/i);
    const yearMatch = body.match(/\byear\s*=\s*[{"]?(\d{4})/i);
    entries.push({
      key: keyMatch?.[1] ?? "unknown",
      title: titleMatch?.[1]?.trim() ?? null,
      year: yearMatch ? Number(yearMatch[1]) : null,
    });
  }
  return entries;
}

function parseMarkdownTables(text: string): Array<{ header: string[]; rows: string[][] }> {
  const lines = text.split(/\r?\n/);
  const tables: Array<{ header: string[]; rows: string[][] }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() ?? "";
    const dividerLine = lines[index + 1]?.trim() ?? "";
    if (!headerLine.includes("|") || !dividerLine.includes("|")) {
      continue;
    }
    if (!/^[:|\-\s]+$/.test(dividerLine.replace(/\|/g, ""))) {
      continue;
    }
    const header = headerLine
      .split("|")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex]?.trim() ?? "";
      if (!rowLine.startsWith("|")) {
        break;
      }
      const row = rowLine
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (row.length === 0) {
        break;
      }
      rows.push(row);
    }
    tables.push({ header, rows });
    index += rows.length + 1;
  }
  return tables;
}

function extractAlignmentRows(matrixText: string): Array<{
  method: string | null;
  family: string | null;
  year: number | null;
}> {
  const rows: Array<{ method: string | null; family: string | null; year: number | null }> = [];
  for (const table of parseMarkdownTables(matrixText)) {
    const methodIndex = table.header.findIndex((cell) => /\bmethod\b|\bpaper\b/.test(cell));
    const familyIndex = table.header.findIndex((cell) => /\bfamily\b|\btaxonomy\b/.test(cell));
    const yearIndex = table.header.findIndex((cell) => /\byear\b/.test(cell));
    for (const row of table.rows) {
      rows.push({
        method: methodIndex >= 0 ? row[methodIndex] ?? null : null,
        family: familyIndex >= 0 ? row[familyIndex] ?? null : null,
        year:
          yearIndex >= 0 && /^\d{4}$/.test(row[yearIndex] ?? "")
            ? Number(row[yearIndex])
            : null,
      });
    }
  }
  return rows.filter((row) => row.method || row.family);
}

function extractMentionedFamilies(text: string, families: string[]): string[] {
  const normalized = normalizeText(text);
  return families.filter((family) => normalized.includes(normalizeText(family)));
}

export async function materializeSurveyReferenceAlignment(params: {
  projectRoot: string;
}): Promise<{
  ready: boolean;
  path: string;
  blockingIssues: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const survey = normalizeSurveyReviewState(manifest.survey_review);
  const [matrixText, bibText, identityRegistry, taxonomyText, evidenceText, benchmarkText] =
    await Promise.all([
      readTextIfExists(resolveProjectArtifactPath(params.projectRoot, survey.sotaMatrixPath)),
      readTextIfExists(path.join(params.projectRoot, "academic_writer", "paper", "refs.bib")),
      readJsonIfExists<Record<string, unknown>>(
        path.join(params.projectRoot, "researcher", "PAPER_IDENTITY_REGISTRY.json")
      ),
      readTextIfExists(path.join(params.projectRoot, "academic_writer", "paper", "sections", "taxonomy.tex")),
      readTextIfExists(
        path.join(params.projectRoot, "academic_writer", "paper", "sections", "evidence_synthesis.tex")
      ),
      readTextIfExists(
        path.join(params.projectRoot, "academic_writer", "paper", "sections", "benchmark_landscape.tex")
      ),
    ]);
  const manuscriptText = [taxonomyText, evidenceText, benchmarkText].filter(Boolean).join("\n");
  const bibEntries = parseBibEntries(bibText);
  const matrixRows = extractAlignmentRows(matrixText ?? "");
  const identityEntries = Array.isArray(identityRegistry?.entries)
    ? identityRegistry.entries.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
      )
    : [];
  const blockingIssues: string[] = [];
  const familyLabels = [...new Set(matrixRows.map((row) => row.family).filter((value): value is string => Boolean(value)))];
  const mentionedFamilies = extractMentionedFamilies(manuscriptText, familyLabels);
  if (familyLabels.length > 0 && mentionedFamilies.length === 0) {
    blockingIssues.push("Family labels from SOTA matrix are not reflected in the taxonomy/evidence manuscript sections.");
  }

  const methodMismatches = matrixRows.filter((row) => {
    if (!row.method) {
      return false;
    }
    const normalizedMethod = normalizeText(row.method);
    const mentioned = normalizeText(manuscriptText).includes(normalizedMethod);
    if (!mentioned) {
      return false;
    }
    const matchingBib = bibEntries.some((entry) => {
      const title = normalizeText(entry.title);
      return title.includes(normalizedMethod) || normalizedMethod.includes(title);
    });
    return !matchingBib;
  });
  if (methodMismatches.length > 0) {
    blockingIssues.push(
      `Methods mentioned in the manuscript are missing aligned bibliography entries: ${methodMismatches
        .map((row) => row.method)
        .filter(Boolean)
        .join(", ")}.`
    );
  }

  const yearMismatches = identityEntries.filter((entry) => {
    const title = normalizeText(String(entry.title ?? ""));
    const year = typeof entry.year === "number" ? entry.year : null;
    if (!title || year == null) {
      return false;
    }
    if (!normalizeText(manuscriptText).includes(title)) {
      return false;
    }
    const manuscriptYearMatches: string[] =
      manuscriptText.match(/\b20\d{2}\b/g)?.map((value) => String(value)) ?? [];
    if (manuscriptYearMatches.length === 0) {
      return false;
    }
    return !manuscriptYearMatches.includes(String(year));
  });
  if (yearMismatches.length > 0) {
    blockingIssues.push(
      `Method/paper year mentions drift away from canonical reference years: ${yearMismatches
        .map((entry) => `${String(entry.title ?? "unknown")} (${String(entry.year ?? "unknown")})`)
        .join(", ")}.`
    );
  }

  const resultPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_SURVEY_REFERENCE_ALIGNMENT_PATH
  );
  if (!resultPath) {
    throw new Error("Unable to resolve survey reference alignment path.");
  }
  await writeJsonEnsured(resultPath, {
    generated_at: new Date().toISOString(),
    ready: blockingIssues.length === 0,
    family_labels: familyLabels,
    mentioned_family_labels: mentionedFamilies,
    method_mismatches: methodMismatches.map((row) => row.method),
    year_mismatches: yearMismatches.map((entry) => ({
      title: entry.title ?? null,
      expected_year: entry.year ?? null,
    })),
    blocking_issues: blockingIssues,
  });

  manifest.survey_reference_alignment = {
    status: blockingIssues.length === 0 ? "ready" : "blocked",
    path: DEFAULT_SURVEY_REFERENCE_ALIGNMENT_PATH,
    blocking_issues: blockingIssues,
    last_updated_at: new Date().toISOString(),
  };
  await writeJsonEnsured(manifestPath, manifest);

  return {
    ready: blockingIssues.length === 0,
    path: DEFAULT_SURVEY_REFERENCE_ALIGNMENT_PATH,
    blockingIssues,
  };
}
