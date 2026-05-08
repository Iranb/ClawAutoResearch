import path from "node:path";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io";
import { normalizeCitationIntegrityState, serializeCitationIntegrityState } from "../workflow-guard-state/authoring-review-state";
import {
  normalizeWritingContractState,
  normalizeWritingMode,
} from "../workflow-guard-state/writing-contract";
import { effectiveMinimumCitationCount } from "../research-writing/citation-count-policy";
import { materializePaperIdentityRegistry } from "./paper-identity-registry";

export type CitationAuditReport = {
  schemaVersion: number;
  generatedAt: string;
  bibliographyPath: string | null;
  bibliographyEntryCount: number;
  minimumCitationCount: number;
  citationCountStatus: "ready" | "needs_revision";
  paperMode: string | null;
  topicRelevanceTopic: string | null;
  topicRelevanceStatus: "ready" | "needs_revision" | "unknown";
  relevantCitationCount: number;
  offTopicCitationCount: number;
  offTopicTitles: string[];
  topicRelevanceSummary: string | null;
  verifiedCitationCount: number;
  unresolvedPlaceholderCount: number;
  suspiciousCitationCount: number;
  hallucinatedCitationCount: number;
  allCitationsReal: boolean;
  issues: string[];
};

const PLACEHOLDER_PATTERNS = [
  /\bplaceholder\b/i,
  /\btbd\b/i,
  /\bxxx\b/i,
  /\[analyzer\]/i,
  /\?\?/,
];

const TOPIC_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "approach",
  "approaches",
  "based",
  "by",
  "for",
  "from",
  "in",
  "into",
  "journal",
  "manuscript",
  "method",
  "methods",
  "model",
  "models",
  "of",
  "on",
  "paper",
  "review",
  "study",
  "survey",
  "system",
  "systems",
  "the",
  "to",
  "using",
  "with",
]);

type ParsedBibEntry = {
  key: string;
  title: string | null;
  journal: string | null;
  booktitle: string | null;
  keywords: string | null;
  abstract: string | null;
  raw: string;
};

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  return matches?.length ?? 0;
}

function inferPaperMode(manifest: Record<string, unknown>): "conference" | "journal" | "survey" | null {
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  return (
    writingContract.paperMode ??
    normalizeWritingMode(manifest.paper_mode ?? manifest.paperMode) ??
    (manifest.workflow_line === "survey" || manifest.paper_type === "survey" ? "survey" : null)
  );
}

function inferTopicRelevanceTopic(manifest: Record<string, unknown>): string | null {
  const surveyReview =
    manifest.survey_review && typeof manifest.survey_review === "object"
      ? (manifest.survey_review as Record<string, unknown>)
      : null;
  const researchProgram =
    manifest.research_program && typeof manifest.research_program === "object"
      ? (manifest.research_program as Record<string, unknown>)
      : null;
  const candidates = [
    surveyReview?.topic,
    researchProgram?.goal,
    researchProgram?.problem_statement,
    manifest.title,
    manifest.project_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTopicTokens(topic: string | null): string[] {
  const normalized = normalizeText(topic);
  if (!normalized) {
    return [];
  }
  const baseTokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 4 &&
        !TOPIC_STOPWORDS.has(token) &&
        !/^\d+$/.test(token)
    );
  const uppercaseTerms =
    String(topic ?? "")
      .match(/\b[A-Z]{2,}\b/g)
      ?.map((token) => token.toLowerCase()) ?? [];
  if (baseTokens.length >= 2) {
    uppercaseTerms.push(baseTokens.map((token) => token[0]).join(""));
  }
  return Array.from(new Set([...baseTokens, ...uppercaseTerms])).filter(Boolean);
}

function readDelimitedValue(source: string, start: number, openChar: "{" | "\""): {
  value: string;
  end: number;
} | null {
  if (openChar === "\"") {
    let cursor = start + 1;
    let value = "";
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === "\"" && source[cursor - 1] !== "\\") {
        return { value, end: cursor + 1 };
      }
      value += char;
      cursor += 1;
    }
    return null;
  }
  let depth = 1;
  let cursor = start + 1;
  let value = "";
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "{") {
      depth += 1;
      value += char;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value, end: cursor + 1 };
      }
      value += char;
    } else {
      value += char;
    }
    cursor += 1;
  }
  return null;
}

function extractBibField(entrySource: string, field: string): string | null {
  const matcher = new RegExp(`(^|[\\n\\r,])\\s*${field}\\s*=`, "i");
  const match = matcher.exec(entrySource);
  if (!match) {
    return null;
  }
  let cursor = match.index + match[0].length;
  while (cursor < entrySource.length && /\s/.test(entrySource[cursor])) {
    cursor += 1;
  }
  const openChar = entrySource[cursor];
  if (openChar === "{" || openChar === "\"") {
    const parsed = readDelimitedValue(entrySource, cursor, openChar as "{" | "\"");
    return parsed?.value?.replace(/[{}]/g, "").replace(/\s+/g, " ").trim() ?? null;
  }
  const remainder = entrySource.slice(cursor);
  const value = remainder.split(/,\s*[\n\r]?/, 1)[0]?.trim() ?? "";
  return value || null;
}

function parseBibEntries(source: string | null): ParsedBibEntry[] {
  if (!source) {
    return [];
  }
  const entries: ParsedBibEntry[] = [];
  const entryStartPattern = /@\w+\s*[{(]/g;
  let match: RegExpExecArray | null;
  while ((match = entryStartPattern.exec(source)) !== null) {
    const openChar = match[0].trim().endsWith("(") ? "(" : "{";
    const closeChar = openChar === "(" ? ")" : "}";
    let cursor = entryStartPattern.lastIndex;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
      }
      cursor += 1;
    }
    const body = source.slice(entryStartPattern.lastIndex, Math.max(entryStartPattern.lastIndex, cursor - 1));
    const commaIndex = body.indexOf(",");
    const key = (commaIndex >= 0 ? body.slice(0, commaIndex) : body).trim();
    const fields = commaIndex >= 0 ? body.slice(commaIndex + 1) : "";
    entries.push({
      key,
      title: extractBibField(fields, "title"),
      journal: extractBibField(fields, "journal"),
      booktitle: extractBibField(fields, "booktitle"),
      keywords: extractBibField(fields, "keywords"),
      abstract: extractBibField(fields, "abstract"),
      raw: body,
    });
    entryStartPattern.lastIndex = cursor;
  }
  return entries;
}

function isCitationTopicallyRelevant(params: {
  entry: ParsedBibEntry;
  topicTokens: string[];
  topicNormalized: string;
}): boolean {
  if (params.topicTokens.length === 0) {
    return true;
  }
  const text = normalizeText(
    [
      params.entry.key,
      params.entry.title,
      params.entry.journal,
      params.entry.booktitle,
      params.entry.keywords,
      params.entry.abstract,
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!text) {
    return false;
  }
  if (params.topicNormalized && text.includes(params.topicNormalized)) {
    return true;
  }
  const matched = params.topicTokens.filter((token) => text.includes(token));
  if (matched.length >= Math.min(2, params.topicTokens.length)) {
    return true;
  }
  if (
    matched.length >= 1 &&
    (params.topicTokens.length <= 2 || matched.some((token) => token.length >= 8))
  ) {
    return true;
  }
  return false;
}

function inferBibliographyPath(manifest: Record<string, unknown>): string | null {
  const citationIntegrity = normalizeCitationIntegrityState(manifest.citation_integrity);
  if (citationIntegrity.bibliographyPath) {
    return citationIntegrity.bibliographyPath;
  }
  return "academic_writer/paper/refs.bib";
}

export async function materializeCitationAudit(params: {
  projectRoot: string;
  bibliographyPath?: string | null;
  outputPath?: string;
}): Promise<CitationAuditReport> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeCitationIntegrityState(manifest.citation_integrity);
  const bibliographyPath = params.bibliographyPath ?? inferBibliographyPath(manifest);
  const bibliographyText = await readProjectText(params.projectRoot, bibliographyPath);
  const bibliographyEntries = parseBibEntries(bibliographyText);
  const identityRegistry = await materializePaperIdentityRegistry({ projectRoot: params.projectRoot });
  const paperMode = inferPaperMode(manifest);
  const minimumCitationCount = effectiveMinimumCitationCount({
    configuredMinimumCitationCount: current.minimumCitationCount,
    paperMode,
  });
  const citationCountStatus =
    bibliographyEntries.length >= minimumCitationCount ? "ready" : "needs_revision";
  const topicRelevanceTopic = inferTopicRelevanceTopic(manifest);
  const topicTokens = buildTopicTokens(topicRelevanceTopic);
  const topicNormalized = normalizeText(topicRelevanceTopic);
  const offTopicEntries =
    topicTokens.length === 0
      ? []
      : bibliographyEntries.filter(
          (entry) =>
            !isCitationTopicallyRelevant({
              entry,
              topicTokens,
              topicNormalized,
            })
        );
  const relevantCitationCount = Math.max(
    0,
    bibliographyEntries.length - offTopicEntries.length
  );
  const topicRelevanceStatus =
    topicTokens.length === 0
      ? "unknown"
      : offTopicEntries.length === 0
        ? "ready"
        : "needs_revision";
  const topicRelevanceSummary =
    topicTokens.length === 0
      ? "Topic relevance could not be evaluated because the project topic or goal is missing."
      : offTopicEntries.length === 0
        ? `All ${bibliographyEntries.length} bibliography entries overlap with the project topic at a broad lexical level.`
        : `${offTopicEntries.length} bibliography entr${offTopicEntries.length === 1 ? "y appears" : "ies appear"} weakly related to the current topic and should be revised or justified.`;
  const unresolvedPlaceholderCount = PLACEHOLDER_PATTERNS.reduce(
    (sum, pattern) => sum + countMatches(bibliographyText ?? "", pattern),
    0
  );
  const suspiciousCitationCount = identityRegistry.entries.filter((entry) =>
    entry.issues.some((issue) => issue === "uncertain_identity" || issue === "placeholder_title")
  ).length;
  const verifiedCitationCount = identityRegistry.entries.filter((entry) => entry.issues.length === 0).length;
  const hallucinatedCitationCount = identityRegistry.entries.filter((entry) =>
    !entry.title && !entry.doi && !entry.arxivId
  ).length;
  const issues: string[] = [];
  if (!bibliographyText) {
    issues.push("missing_bibliography");
  }
  if (unresolvedPlaceholderCount > 0) {
    issues.push("bibliography_placeholders_present");
  }
  if (suspiciousCitationCount > 0) {
    issues.push("suspicious_canonical_papers_present");
  }
  if (hallucinatedCitationCount > 0) {
    issues.push("hallucinated_identity_entries_present");
  }
  if (minimumCitationCount > 0 && bibliographyEntries.length < minimumCitationCount) {
    issues.push("bibliography_minimum_count_not_met");
  }
  if (topicRelevanceStatus === "needs_revision") {
    issues.push("off_topic_citations_present");
  }
  const report: CitationAuditReport = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    bibliographyPath,
    bibliographyEntryCount: bibliographyEntries.length,
    minimumCitationCount,
    citationCountStatus,
    paperMode,
    topicRelevanceTopic,
    topicRelevanceStatus,
    relevantCitationCount,
    offTopicCitationCount: offTopicEntries.length,
    offTopicTitles: offTopicEntries
      .map((entry) => entry.title ?? entry.key)
      .filter((value): value is string => Boolean(value))
      .slice(0, 12),
    topicRelevanceSummary,
    verifiedCitationCount,
    unresolvedPlaceholderCount,
    suspiciousCitationCount,
    hallucinatedCitationCount,
    allCitationsReal:
      bibliographyText != null &&
      unresolvedPlaceholderCount === 0 &&
      hallucinatedCitationCount === 0 &&
      suspiciousCitationCount === 0,
    issues,
  };
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? "researcher/CITATION_AUDIT_REPORT.json",
    report
  );

  const nextState = {
    ...current,
    verificationStatus:
      report.allCitationsReal &&
      report.citationCountStatus === "ready" &&
      report.topicRelevanceStatus !== "needs_revision"
        ? "verified"
        : "needs_revision",
    verificationReportPath: params.outputPath ?? "researcher/CITATION_AUDIT_REPORT.json",
    bibliographyPath,
    bibliographyEntryCount: report.bibliographyEntryCount,
    verifiedCitationCount,
    unresolvedPlaceholderCount,
    suspiciousCitationCount,
    hallucinatedCitationCount,
    minimumCitationCount,
    allCitationsReal: report.allCitationsReal,
    topicRelevanceTopic,
    topicRelevanceStatus,
    relevantCitationCount,
    offTopicCitationCount: offTopicEntries.length,
    topicRelevanceSummary,
    bibliographyPageCount:
      bibliographyText == null ? 0 : Math.max(1, Math.ceil(bibliographyText.split(/\r?\n/).length / 45)),
    lastVerifiedAt: report.generatedAt,
    pendingReason: report.issues.length > 0 ? report.issues.join(", ") : null,
  };
  manifest.citation_integrity = serializeCitationIntegrityState(nextState);
  await writeProjectManifest(params.projectRoot, manifest);
  return report;
}
