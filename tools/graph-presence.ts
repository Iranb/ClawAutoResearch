import os from "node:os";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type GraphPresenceStatus =
  | "ready"
  | "missing_papers"
  | "missing_corpus"
  | "missing_sources";

type ManifestLike = Record<string, unknown>;

type ExpectedPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
  sourceHints: string[];
  sourceKind: "markdown" | "pdf" | "unknown";
};

type CorpusPaper = {
  paperId: string | null;
  paperTitle: string | null;
  sourceKey: string | null;
  activeInGraph: boolean;
  arxivIds: Set<string>;
  dois: Set<string>;
  normalizedTitles: Set<string>;
  sourceHints: Set<string>;
  sourceBasenames: Set<string>;
};

export type GraphPresenceMatch = {
  canonicalId: string;
  title: string | null;
  matchedBy: "arxiv" | "doi" | "source_path" | "title";
  corpusPaperId: string | null;
  corpusPaperTitle: string | null;
  corpusSourceKey: string | null;
};

export type GraphPresenceMissingPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
};

export type GraphPresenceCheckResult = {
  projectRoot: string;
  projectId: string | null;
  checkedAt: string;
  status: GraphPresenceStatus;
  blockingReason: string | null;
  reportPath: string;
  paperSourceIndexPath: string | null;
  usedPaperSourceIndex: boolean;
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  corpusRoot: string | null;
  corpusName: string | null;
  corpusManifestPath: string | null;
  corpusMetaPath: string | null;
  refreshRequired: boolean;
  refreshReason: string | null;
  presentPapers: GraphPresenceMatch[];
  missingPapers: GraphPresenceMissingPaper[];
  manifestUpdated: boolean;
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
];

const ARXIV_ID_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/gi;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function pickString(
  source: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(ARXIV_ID_REGEX);
  if (!match || match.length === 0) {
    return null;
  }
  return match[0].toLowerCase().replace(/v\d+$/, "");
}

function extractArxivIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      Array.from(value.matchAll(ARXIV_ID_REGEX))
        .map((match) => normalizeArxivId(match[0]))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(DOI_REGEX);
  if (!match || match.length === 0) {
    return null;
  }
  return match[0].toLowerCase();
}

function extractDois(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      Array.from(value.matchAll(DOI_REGEX))
        .map((match) => normalizeDoi(match[0]))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let normalized = value.trim();
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/\.(pdf|md)$/i, "");
  normalized = normalized.replace(/^[^/\\]*[\\/]/g, "");
  normalized = normalized.replace(/^paper[_-]/i, "");
  normalized = normalized.replace(ARXIV_ID_REGEX, " ");
  normalized = normalized.replace(DOI_REGEX, " ");
  normalized = normalized.replace(/--+/g, " ");
  normalized = normalized.replace(/[_./]+/g, " ");
  normalized = normalized.replace(/[^a-z0-9]+/gi, " ");
  normalized = normalized.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(targetPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonEnsured(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readManifest(projectRoot: string): Promise<ManifestLike> {
  return (
    (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {}
  );
}

async function saveManifest(projectRoot: string, manifest: ManifestLike): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
}

function inferProjectId(projectRoot: string, manifest: ManifestLike): string | null {
  return asString(manifest.project_id) ?? path.basename(projectRoot);
}

function getDefaultPaperSourceDir(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return path.join(os.homedir(), ".papernexus", "papers", projectId);
}

function getGraphPresenceReportPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json");
}

function getRegistryPath(): string {
  const papernexusHome = asString(process.env.PAPERNEXUS_HOME);
  if (papernexusHome) {
    return path.join(path.resolve(papernexusHome), "registry.json");
  }
  return path.join(os.homedir(), ".papernexus", "registry.json");
}

async function resolveCorpusRootFromRegistry(
  corpusName: string | null
): Promise<string | null> {
  if (!corpusName) {
    return null;
  }
  const registry = await readJsonIfExists<Record<string, unknown>>(getRegistryPath());
  const corpora = Array.isArray(registry?.corpora) ? registry.corpora : [];
  for (const entry of corpora) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const name = pickString(record, ["name"]);
    const rootPath = pickString(record, ["rootPath", "root_path"]);
    if ((name && name === corpusName) || (rootPath && rootPath === corpusName)) {
      return rootPath ? path.resolve(rootPath) : null;
    }
  }
  return null;
}

function collectSourceHints(record: Record<string, unknown> | null): string[] {
  if (!record) {
    return [];
  }
  return uniqueStrings([
    pickString(record, ["source_path", "sourcePath"]),
    pickString(record, ["canonical_source_path", "canonicalSourcePath"]),
    pickString(record, ["markdown_path", "markdownPath", "source_markdown_path", "sourceMarkdownPath"]),
    pickString(record, ["pdf_path", "pdfPath", "source_pdf_path", "sourcePdfPath"]),
    pickString(record, ["input_path", "inputPath"]),
    pickString(record, ["source_key", "sourceKey"]),
    pickString(record, ["path", "file", "filePath"]),
    ...asStringArray(record.source_variants),
    ...asStringArray(record.sourceVariants),
  ].filter((item): item is string => Boolean(item)));
}

function inferSourceKind(sourceHints: string[]): "markdown" | "pdf" | "unknown" {
  for (const hint of sourceHints) {
    if (hint.toLowerCase().endsWith(".md")) {
      return "markdown";
    }
    if (hint.toLowerCase().endsWith(".pdf")) {
      return "pdf";
    }
  }
  return "unknown";
}

function buildExpectedPaperFromRecord(
  raw: Record<string, unknown>,
  fallbackCanonicalId?: string
): ExpectedPaper | null {
  const sourceHints = collectSourceHints(raw);
  const title =
    pickString(raw, ["title", "paper_title", "paperTitle", "name"]) ??
    (sourceHints.length > 0
      ? path.basename(sourceHints[0], path.extname(sourceHints[0]))
      : null);
  const arxivId =
    pickString(raw, ["arxiv_id", "arxivId", "arxiv"]) ??
    sourceHints.find((hint) => Boolean(normalizeArxivId(hint))) ??
    fallbackCanonicalId ??
    null;
  const doi =
    pickString(raw, ["doi", "doi_url", "doiUrl"]) ??
    sourceHints.find((hint) => Boolean(normalizeDoi(hint))) ??
    fallbackCanonicalId ??
    null;
  const normalizedTitle =
    pickString(raw, ["normalized_title", "normalizedTitle"]) ??
    normalizeTitle(title) ??
    normalizeTitle(fallbackCanonicalId) ??
    (sourceHints.length > 0 ? normalizeTitle(sourceHints[0]) : null);
  const canonicalId =
    pickString(raw, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]) ??
    (normalizeArxivId(arxivId) ? `arxiv:${normalizeArxivId(arxivId)}` : null) ??
    (normalizeDoi(doi) ? `doi:${normalizeDoi(doi)}` : null) ??
    (normalizedTitle ? `title:${normalizedTitle}` : null) ??
    fallbackCanonicalId ??
    null;

  if (!canonicalId && !title && sourceHints.length === 0) {
    return null;
  }

  return {
    canonicalId: canonicalId ?? `title:${normalizedTitle ?? "unknown"}`,
    title,
    normalizedTitle,
    arxivId: normalizeArxivId(arxivId),
    doi: normalizeDoi(doi),
    sourceHints,
    sourceKind: inferSourceKind(sourceHints),
  };
}

function mergeExpectedPaper(target: ExpectedPaper, incoming: ExpectedPaper): ExpectedPaper {
  return {
    canonicalId: target.canonicalId,
    title: target.title ?? incoming.title,
    normalizedTitle: target.normalizedTitle ?? incoming.normalizedTitle,
    arxivId: target.arxivId ?? incoming.arxivId,
    doi: target.doi ?? incoming.doi,
    sourceHints: uniqueStrings([...target.sourceHints, ...incoming.sourceHints]),
    sourceKind:
      target.sourceKind === "markdown" || incoming.sourceKind !== "markdown"
        ? target.sourceKind
        : "markdown",
  };
}

function parsePaperSourceIndex(raw: unknown): ExpectedPaper[] {
  if (!raw) {
    return [];
  }
  let entries: Array<{ key?: string; value: unknown }> = [];
  if (Array.isArray(raw)) {
    entries = raw.map((value) => ({ value }));
  } else {
    const record = asRecord(raw);
    if (record) {
      for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
        if (Array.isArray(record[key])) {
          entries = (record[key] as unknown[]).map((value) => ({ value }));
          break;
        }
      }
      if (entries.length === 0) {
        entries = Object.entries(record).map(([key, value]) => ({ key, value }));
      }
    }
  }

  const byCanonicalId = new Map<string, ExpectedPaper>();
  for (const entry of entries) {
    const record = asRecord(entry.value);
    if (!record) {
      continue;
    }
    const paper = buildExpectedPaperFromRecord(record, entry.key);
    if (!paper) {
      continue;
    }
    const existing = byCanonicalId.get(paper.canonicalId);
    byCanonicalId.set(
      paper.canonicalId,
      existing ? mergeExpectedPaper(existing, paper) : paper
    );
  }
  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  );
}

async function collectPaperFiles(rootDir: string): Promise<string[]> {
  const stack = [rootDir];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name === ".papernexus" ||
        entry.name === ".git" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (/\.(md|pdf)$/i.test(entry.name)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function parseExpectedPapersFromFiles(files: string[]): ExpectedPaper[] {
  const byCanonicalId = new Map<string, ExpectedPaper>();
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    const titlePart = basename.includes("--")
      ? basename.split("--").slice(1).join("--")
      : basename;
    const paper = buildExpectedPaperFromRecord(
      {
        title: titlePart,
        source_path: filePath,
        normalized_title: normalizeTitle(titlePart),
      },
      basename
    );
    if (!paper) {
      continue;
    }
    const existing = byCanonicalId.get(paper.canonicalId);
    if (!existing) {
      byCanonicalId.set(paper.canonicalId, {
        ...paper,
        sourceKind: ext === ".md" ? "markdown" : ext === ".pdf" ? "pdf" : "unknown",
      });
      continue;
    }
    const merged = mergeExpectedPaper(existing, {
      ...paper,
      sourceKind: ext === ".md" ? "markdown" : ext === ".pdf" ? "pdf" : "unknown",
    });
    if (existing.sourceKind !== "markdown" && ext === ".md") {
      merged.sourceKind = "markdown";
    }
    byCanonicalId.set(paper.canonicalId, merged);
  }
  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  );
}

async function resolveExpectedPapers(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
}): Promise<{
  papers: ExpectedPaper[];
  paperSourceIndexPath: string | null;
  usedPaperSourceIndex: boolean;
}> {
  const paperSourceIndexPath = path.join(
    params.projectRoot,
    "researcher",
    "PAPER_SOURCE_INDEX.json"
  );
  const paperSourceIndex = await readJsonIfExists<unknown>(paperSourceIndexPath);
  const indexedPapers = parsePaperSourceIndex(paperSourceIndex);
  if (indexedPapers.length > 0) {
    return {
      papers: indexedPapers,
      paperSourceIndexPath,
      usedPaperSourceIndex: true,
    };
  }

  const sourceDir =
    pickString(params.manifest, ["paper_source_dir", "graph_source_dir"]) ??
    getDefaultPaperSourceDir(params.projectId);
  if (!sourceDir) {
    return {
      papers: [],
      paperSourceIndexPath: await pathExists(paperSourceIndexPath)
        ? paperSourceIndexPath
        : null,
      usedPaperSourceIndex: false,
    };
  }

  const files = await collectPaperFiles(path.resolve(sourceDir));
  return {
    papers: parseExpectedPapersFromFiles(files),
    paperSourceIndexPath: await pathExists(paperSourceIndexPath)
      ? paperSourceIndexPath
      : null,
    usedPaperSourceIndex: false,
  };
}

async function resolveCorpusRoot(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
}): Promise<{ corpusRoot: string | null; corpusName: string | null }> {
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const status = await readJsonIfExists<Record<string, unknown>>(statusPath);
  const corpusName =
    pickString(status, ["corpus_name", "corpusName"]) ??
    pickString(params.manifest, ["papernexus_corpus"]) ??
    params.projectId;
  const registryRoot = await resolveCorpusRootFromRegistry(corpusName);
  const candidates = uniqueStrings([
    pickString(status, ["corpus_root", "corpusRoot", "root_path", "rootPath", "source_dir", "sourceDir"]),
    registryRoot,
    pickString(params.manifest, ["graph_source_dir"]),
    pickString(params.manifest, ["paper_source_dir"]),
    getDefaultPaperSourceDir(params.projectId),
  ].filter((item): item is string => Boolean(item)));

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (await pathExists(absolute)) {
      return {
        corpusRoot: absolute,
        corpusName,
      };
    }
  }

  return {
    corpusRoot: candidates.length > 0 ? path.resolve(candidates[0]) : null,
    corpusName,
  };
}

function buildCorpusPaper(entry: Record<string, unknown>): CorpusPaper {
  const sourceHints = uniqueStrings([
    pickString(entry, ["sourceKey", "source_key"]),
    pickString(entry, ["inputPath", "input_path"]),
    pickString(entry, ["sourcePath", "source_path"]),
    pickString(entry, ["sourceMarkdownPath", "source_markdown_path"]),
    pickString(entry, ["sourcePdfPath", "source_pdf_path"]),
    pickString(entry, ["canonicalSourceKey", "canonical_source_key"]),
    pickString(entry, ["duplicateOfSourceKey", "duplicate_of_source_key"]),
  ].filter((item): item is string => Boolean(item)));
  const paperTitle = pickString(entry, ["paperTitle", "paper_title", "title"]);
  const titleHints = uniqueStrings([
    paperTitle,
    ...sourceHints.map((hint) => path.basename(hint, path.extname(hint))),
  ].filter((item): item is string => Boolean(item)));
  return {
    paperId: pickString(entry, ["paperId", "paper_id"]),
    paperTitle,
    sourceKey: pickString(entry, ["sourceKey", "source_key"]),
    activeInGraph:
      typeof entry.activeInGraph === "boolean"
        ? entry.activeInGraph
        : typeof entry.active_in_graph === "boolean"
          ? Boolean(entry.active_in_graph)
          : true,
    arxivIds: new Set(sourceHints.flatMap((hint) => extractArxivIds(hint))),
    dois: new Set(sourceHints.flatMap((hint) => extractDois(hint))),
    normalizedTitles: new Set(
      titleHints
        .map((value) => normalizeTitle(value))
        .filter((value): value is string => Boolean(value))
    ),
    sourceHints: new Set(sourceHints.map((hint) => path.resolve(hint))),
    sourceBasenames: new Set(
      sourceHints.map((hint) => path.basename(hint, path.extname(hint)).toLowerCase())
    ),
  };
}

function matchExpectedPaper(
  expected: ExpectedPaper,
  corpus: CorpusPaper[]
): GraphPresenceMatch | null {
  const activeCorpus = corpus.filter((entry) => entry.activeInGraph);

  if (expected.arxivId) {
    const match = activeCorpus.find((entry) => entry.arxivIds.has(expected.arxivId as string));
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        matchedBy: "arxiv",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  if (expected.doi) {
    const match = activeCorpus.find((entry) => entry.dois.has(expected.doi as string));
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        matchedBy: "doi",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  const sourcePaths = expected.sourceHints.map((hint) => path.resolve(hint));
  const sourceBasenames = expected.sourceHints.map((hint) =>
    path.basename(hint, path.extname(hint)).toLowerCase()
  );
  const sourcePathMatch = activeCorpus.find((entry) =>
    sourcePaths.some((hint) => entry.sourceHints.has(hint)) ||
    sourceBasenames.some((basename) => entry.sourceBasenames.has(basename))
  );
  if (sourcePathMatch) {
    return {
      canonicalId: expected.canonicalId,
      title: expected.title,
      matchedBy: "source_path",
      corpusPaperId: sourcePathMatch.paperId,
      corpusPaperTitle: sourcePathMatch.paperTitle,
      corpusSourceKey: sourcePathMatch.sourceKey,
    };
  }

  if (expected.normalizedTitle) {
    const match = activeCorpus.find((entry) =>
      entry.normalizedTitles.has(expected.normalizedTitle as string)
    );
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        matchedBy: "title",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  return null;
}

function buildBlockingReason(
  status: GraphPresenceStatus,
  missingPapers: GraphPresenceMissingPaper[],
  expectedPaperCount: number,
  corpusRoot: string | null
): string | null {
  if (status === "ready") {
    return null;
  }
  if (status === "missing_sources") {
    return "No canonical papers are available yet in PAPER_SOURCE_INDEX.json or paper_source_dir, so graph-grounded work cannot proceed.";
  }
  if (status === "missing_corpus") {
    return `PaperNexus corpus is not ready at ${corpusRoot ?? "the expected corpus root"} for ${expectedPaperCount} expected paper(s). Rebuild or refresh the corpus before frontier mapping or ideation.`;
  }
  if (missingPapers.length === 0) {
    return "PaperNexus graph presence check failed; rebuild the corpus before novelty-sensitive work.";
  }
  const preview = missingPapers
    .slice(0, 3)
    .map((paper) => paper.arxivId ?? paper.title ?? paper.canonicalId)
    .join("; ");
  return `PaperNexus corpus is missing ${missingPapers.length}/${expectedPaperCount} expected paper(s): ${preview}${missingPapers.length > 3 ? "; ..." : ""}. Refresh the graph before frontier mapping or ideation.`;
}

function serializeMissingPapers(missingPapers: GraphPresenceMissingPaper[]) {
  return missingPapers.map((paper) => ({
    canonical_id: paper.canonicalId,
    title: paper.title,
    normalized_title: paper.normalizedTitle,
    arxiv_id: paper.arxivId,
    doi: paper.doi,
  }));
}

export async function checkGraphPresenceForWorkflow(params: {
  projectRoot: string;
  updateManifest?: boolean;
}): Promise<GraphPresenceCheckResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifest(projectRoot);
  const projectId = inferProjectId(projectRoot, manifest);
  const checkedAt = new Date().toISOString();
  const reportPath = getGraphPresenceReportPath(projectRoot);

  const expected = await resolveExpectedPapers({
    projectRoot,
    manifest,
    projectId,
  });
  const corpusResolution = await resolveCorpusRoot({
    projectRoot,
    manifest,
    projectId,
  });
  const corpusManifestPath = corpusResolution.corpusRoot
    ? path.join(corpusResolution.corpusRoot, ".papernexus", "sources.json")
    : null;
  const corpusMetaPath = corpusResolution.corpusRoot
    ? path.join(corpusResolution.corpusRoot, ".papernexus", "meta.json")
    : null;
  const sourceManifest = corpusManifestPath
    ? await readJsonIfExists<Record<string, unknown>>(corpusManifestPath)
    : null;
  const corpusMeta = corpusMetaPath
    ? await readJsonIfExists<Record<string, unknown>>(corpusMetaPath)
    : null;

  const corpusEntries = Array.isArray(sourceManifest?.sources)
    ? sourceManifest.sources
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => buildCorpusPaper(entry))
    : [];

  const presentPapers: GraphPresenceMatch[] = [];
  const missingPapers: GraphPresenceMissingPaper[] = [];
  for (const paper of expected.papers) {
    const match = matchExpectedPaper(paper, corpusEntries);
    if (match) {
      presentPapers.push(match);
    } else {
      missingPapers.push({
        canonicalId: paper.canonicalId,
        title: paper.title,
        normalizedTitle: paper.normalizedTitle,
        arxivId: paper.arxivId,
        doi: paper.doi,
      });
    }
  }

  let status: GraphPresenceStatus;
  if (expected.papers.length === 0) {
    status = "missing_sources";
  } else if (!sourceManifest || !corpusMeta) {
    status = "missing_corpus";
  } else if (missingPapers.length > 0) {
    status = "missing_papers";
  } else {
    status = "ready";
  }

  const refreshRequired = status === "missing_corpus" || status === "missing_papers";
  const refreshReason =
    status === "ready"
      ? null
      : buildBlockingReason(
          status,
          missingPapers,
          expected.papers.length,
          corpusResolution.corpusRoot
        );

  const result: GraphPresenceCheckResult = {
    projectRoot,
    projectId,
    checkedAt,
    status,
    blockingReason: refreshReason,
    reportPath,
    paperSourceIndexPath: expected.paperSourceIndexPath,
    usedPaperSourceIndex: expected.usedPaperSourceIndex,
    expectedPaperCount: expected.papers.length,
    presentPaperCount: presentPapers.length,
    missingPaperCount: missingPapers.length,
    corpusRoot: corpusResolution.corpusRoot,
    corpusName:
      corpusResolution.corpusName ??
      pickString(corpusMeta, ["name", "corpusName", "corpus_name"]),
    corpusManifestPath,
    corpusMetaPath,
    refreshRequired,
    refreshReason,
    presentPapers,
    missingPapers,
    manifestUpdated: false,
  };

  await writeJsonEnsured(reportPath, {
    checked_at: checkedAt,
    project_id: projectId,
    status,
    blocking_reason: result.blockingReason,
    corpus_root: result.corpusRoot,
    corpus_name: result.corpusName,
    paper_source_index_path: result.paperSourceIndexPath,
    used_paper_source_index: result.usedPaperSourceIndex,
    expected_paper_count: result.expectedPaperCount,
    present_paper_count: result.presentPaperCount,
    missing_paper_count: result.missingPaperCount,
    refresh_required: result.refreshRequired,
    refresh_reason: result.refreshReason,
    missing_papers: serializeMissingPapers(result.missingPapers),
    present_papers: result.presentPapers.map((paper) => ({
      canonical_id: paper.canonicalId,
      title: paper.title,
      matched_by: paper.matchedBy,
      corpus_paper_id: paper.corpusPaperId,
      corpus_paper_title: paper.corpusPaperTitle,
      corpus_source_key: paper.corpusSourceKey,
    })),
  });

  if (params.updateManifest !== false) {
    const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
    manifest.paper_ingestion = {
      ...paperIngestion,
      graph_presence_checked_at: checkedAt,
      graph_presence_status: status,
      graph_presence_report_path: path.relative(projectRoot, reportPath),
      graph_presence_expected_papers: result.expectedPaperCount,
      graph_presence_present_papers: result.presentPaperCount,
      graph_presence_missing_papers: serializeMissingPapers(result.missingPapers),
      refresh_required: refreshRequired ? true : false,
      refresh_reason: refreshRequired ? refreshReason : null,
    };
    await saveManifest(projectRoot, manifest);
    result.manifestUpdated = true;
  }

  return result;
}
