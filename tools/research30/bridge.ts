import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";

const execFileAsync = promisify(execFile);

export type Research30QueryInput = {
  query: string;
  domain?: string | null;
  rationale?: string | null;
  entry_key?: string | null;
  expected_title?: string | null;
  expected_authors?: string | null;
  expected_year?: string | null;
};

type Research30TopResult = {
  source?: string | null;
  title?: string | null;
  authors?: string | null;
  abstract?: string | null;
  url?: string | null;
  doi?: string | null;
  venue?: string | null;
  date?: string | null;
  score?: number | null;
  why_relevant?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Research30QueryResult = {
  query: string;
  domain?: string | null;
  rationale?: string | null;
  entry_key?: string | null;
  expected_title?: string | null;
  expected_authors?: string | null;
  expected_year?: string | null;
  range?: Record<string, string>;
  source_counts?: Record<string, number>;
  total_results?: number;
  top_score?: number | null;
  top_results?: Research30TopResult[];
  report?: Record<string, unknown>;
};

export type Research30BridgeResult = {
  backend: "research30";
  available: boolean;
  script_path?: string | null;
  error?: string | null;
  queries: Research30QueryResult[];
  summary?: {
    query_count: number;
    domain_count: number;
    domains: string[];
    total_top_results: number;
    days: number;
    sources: string;
    depth: string;
    backend: "research30";
    source_coverage: string[];
  };
};

function findRepoRootFromModule(moduleUrl: string): string {
  const filePath = fileURLToPath(moduleUrl);
  const candidates = [
    path.resolve(path.dirname(filePath), "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    const scriptPath = path.join(candidate, "scripts", "research30_bridge.py");
    try {
      fsSync.accessSync(scriptPath);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates.at(-1) ?? path.resolve(path.dirname(filePath), "..", "..");
}

const REPO_ROOT = findRepoRootFromModule(import.meta.url);
const RESEARCH30_BRIDGE_SCRIPT = path.join(REPO_ROOT, "scripts", "research30_bridge.py");

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeQueries(queries: Research30QueryInput[]): Research30QueryInput[] {
  const deduped: Research30QueryInput[] = [];
  const seen = new Set<string>();
  for (const raw of queries) {
    const query = readString(raw.query);
    if (!query) {
      continue;
    }
    const domain = readString(raw.domain);
    const key = `${(domain ?? "").toLowerCase()}::${query.toLowerCase()}::${readString(raw.entry_key) ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      query,
      domain,
      rationale: readString(raw.rationale),
      entry_key: readString(raw.entry_key),
      expected_title: readString(raw.expected_title),
      expected_authors: readString(raw.expected_authors),
      expected_year: readString(raw.expected_year),
    });
  }
  return deduped;
}

export async function runResearch30Bridge(params: {
  queries: Research30QueryInput[];
  days?: number;
  sources?: string | null;
  depth?: "quick" | "default" | "deep";
  topK?: number;
  mock?: boolean;
}) {
  const queries = normalizeQueries(params.queries);
  if (!queries.length) {
    return {
      backend: "research30",
      available: false,
      error: "No valid research30 queries were provided.",
      queries: [],
    } satisfies Research30BridgeResult;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research30-"));
  try {
    const queriesJsonPath = path.join(tempDir, "queries.json");
    await fs.writeFile(queriesJsonPath, `${JSON.stringify(queries, null, 2)}\n`, "utf8");
    const command = [
      "python3",
      RESEARCH30_BRIDGE_SCRIPT,
      "--queries-json",
      queriesJsonPath,
      "--days",
      String(Math.max(1, Math.floor(params.days ?? 3650))),
      "--sources",
      readString(params.sources) ?? "all",
      "--depth",
      params.depth ?? "default",
      "--top-k",
      String(Math.max(1, Math.floor(params.topK ?? 10))),
    ];
    if (params.mock) {
      command.push("--mock");
    }
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync(command[0], command.slice(1), {
        cwd: REPO_ROOT,
        env: process.env,
      }));
    } catch (error) {
      const captured = (error as { stdout?: string }).stdout;
      if (typeof captured !== "string" || !captured.trim()) {
        throw error;
      }
      stdout = captured;
    }
    return JSON.parse(stdout) as Research30BridgeResult;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function renderIdeaCatalystResearch30Markdown(report: Research30BridgeResult): string {
  const lines = [
    "# Idea-Catalyst Research30 Report",
    "",
    `- backend: ${report.backend}`,
    `- available: ${report.available ? "yes" : "no"}`,
  ];
  if (report.script_path) {
    lines.push(`- script_path: \`${report.script_path}\``);
  }
  if (report.summary) {
    lines.push(`- days: ${report.summary.days}`);
    lines.push(`- sources: ${report.summary.sources}`);
    lines.push(`- depth: ${report.summary.depth}`);
    lines.push(`- query_count: ${report.summary.query_count}`);
    lines.push(`- domain_count: ${report.summary.domain_count}`);
    lines.push(`- source_coverage: ${report.summary.source_coverage.join(", ") || "none"}`);
  }
  if (report.error) {
    lines.push(`- error: ${report.error}`);
  }
  lines.push("", "## Queries", "");
  for (const query of report.queries) {
    lines.push(`### ${query.domain ?? "general"} :: ${query.query}`);
    if (query.rationale) {
      lines.push(`- rationale: ${query.rationale}`);
    }
    lines.push(`- total_results: ${query.total_results ?? 0}`);
    lines.push(`- top_score: ${query.top_score ?? "n/a"}`);
    lines.push("");
    for (const result of query.top_results ?? []) {
      lines.push(
        `- (${result.score ?? "n/a"}) ${result.title ?? "Untitled"} [${result.source ?? "unknown"}]`
      );
      lines.push(`  - date: ${result.date ?? "n/a"}`);
      lines.push(`  - venue: ${result.venue ?? "n/a"}`);
      lines.push(`  - doi: ${result.doi ?? "n/a"}`);
      lines.push(`  - url: ${result.url ?? "n/a"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function runIdeaCatalystResearch30(params: {
  projectRoot: string;
  scoutingReportPath?: string | null;
  requisitionPath?: string | null;
  reportJsonPath?: string | null;
  reportMarkdownPath?: string | null;
  days?: number;
  sources?: string | null;
  depth?: "quick" | "default" | "deep";
  topK?: number;
  mock?: boolean;
  updateScoutReport?: boolean;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const scoutingReportPath =
    readString(params.scoutingReportPath) ??
    "researcher/idea-catalyst/SCOUTING_REPORT.json";
  const requisitionPath =
    readString(params.requisitionPath) ??
    "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json";
  const reportJsonPath =
    readString(params.reportJsonPath) ??
    "researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.json";
  const reportMarkdownPath =
    readString(params.reportMarkdownPath) ??
    "researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.md";

  const [scoutReport, requisition] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, scoutingReportPath)),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, requisitionPath)),
  ]);

  const requisitionQueries = Array.isArray(requisition?.search_queries)
    ? requisition?.search_queries ?? []
    : [];
  const scoutQueries = Array.isArray(scoutReport?.cross_domain_searches)
    ? scoutReport?.cross_domain_searches ?? []
    : [];

  const queries: Research30QueryInput[] = [];
  for (const entry of requisitionQueries) {
    if (!entry || typeof entry !== "object") continue;
    queries.push({
      domain: readString((entry as Record<string, unknown>).domain),
      query: readString((entry as Record<string, unknown>).query) ?? "",
      rationale: readString((entry as Record<string, unknown>).rationale),
    });
  }
  for (const entry of scoutQueries) {
    if (!entry || typeof entry !== "object") continue;
    const domain = readString((entry as Record<string, unknown>).domain);
    const rationale = readString((entry as Record<string, unknown>).domain_rationale);
    const nestedQueries = Array.isArray((entry as Record<string, unknown>).queries)
      ? ((entry as Record<string, unknown>).queries as unknown[])
      : [];
    for (const rawQuery of nestedQueries) {
      const query = readString(rawQuery);
      if (!query) continue;
      queries.push({ domain, rationale, query });
    }
  }

  const report = await runResearch30Bridge({
    queries,
    days: params.days ?? 3650,
    sources: params.sources ?? "all",
    depth: params.depth ?? "default",
    topK: params.topK ?? 10,
    mock: params.mock,
  });

  await Promise.all([
    writeJsonEnsured(path.join(projectRoot, reportJsonPath), report),
    writeTextEnsured(
      path.join(projectRoot, reportMarkdownPath),
      renderIdeaCatalystResearch30Markdown(report)
    ),
  ]);

  let scoutReportUpdated = false;
  if (params.updateScoutReport !== false && scoutReport) {
    const hitsByDomain = new Map<
      string,
      { totalHits: number; topResults: Research30TopResult[]; topScore: number | null }
    >();
    for (const queryReport of report.queries) {
      const domain = readString(queryReport.domain);
      if (!domain) continue;
      const existing = hitsByDomain.get(domain) ?? {
        totalHits: 0,
        topResults: [],
        topScore: null,
      };
      const nextTopResults = [...existing.topResults, ...(queryReport.top_results ?? [])]
        .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
        .slice(0, 5);
      hitsByDomain.set(domain, {
        totalHits: existing.totalHits + Number(queryReport.total_results ?? 0),
        topResults: nextTopResults,
        topScore:
          typeof queryReport.top_score === "number"
            ? Math.max(existing.topScore ?? 0, queryReport.top_score)
            : existing.topScore,
      });
    }

    const candidateDomains = Array.isArray(scoutReport.candidate_domains)
      ? scoutReport.candidate_domains
      : [];
    scoutReport.candidate_domains = candidateDomains.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      const domain = readString(record.domain);
      const hitSummary = domain ? hitsByDomain.get(domain) : null;
      return {
        ...record,
        research30_validation: hitSummary
          ? {
              total_hits: hitSummary.totalHits,
              top_score: hitSummary.topScore,
              top_results: hitSummary.topResults.map((result) => ({
                title: result.title ?? null,
                source: result.source ?? null,
                score: result.score ?? null,
                date: result.date ?? null,
                doi: result.doi ?? null,
                url: result.url ?? null,
              })),
            }
          : {
              total_hits: 0,
              top_score: null,
              top_results: [],
            },
      };
    });
    scoutReport.research30_validation = {
      backend: "research30",
      report_json_path: reportJsonPath,
      report_markdown_path: reportMarkdownPath,
      query_count: report.summary?.query_count ?? report.queries.length,
      day_horizon: report.summary?.days ?? params.days ?? 3650,
      source_coverage: report.summary?.source_coverage ?? [],
      domains: report.summary?.domains ?? [],
    };
    await writeJsonEnsured(path.join(projectRoot, scoutingReportPath), scoutReport);
    scoutReportUpdated = true;
  }

  return {
    reportJsonPath,
    reportMarkdownPath,
    queryCount: report.summary?.query_count ?? report.queries.length,
    domainCount: report.summary?.domain_count ?? 0,
    scoutReportUpdated,
    report,
  };
}
