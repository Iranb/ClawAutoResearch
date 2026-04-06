import * as path from "node:path";
import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CitationGroundingEntry = {
  citeKey: string;
  found: boolean;
  corpusPaperId: string | null;
  corpusPaperTitle: string | null;
  status: "VERIFIED" | "UNVERIFIED";
};

export type CitationGroundingResult = {
  entries: CitationGroundingEntry[];
  verifiedCount: number;
  unverifiedCount: number;
  totalCitations: number;
  reportPath: string;
};

type McpClientLike = {
  callTool: (
    toolName: string,
    params?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data: unknown; error: string | null }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectTextContent(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextContent(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const texts: string[] = [];
  if (typeof record.text === "string" && record.text.trim()) {
    texts.push(record.text);
  }
  if (Array.isArray(record.content)) {
    texts.push(...record.content.flatMap((entry) => collectTextContent(entry)));
  }
  if ("data" in record) {
    texts.push(...collectTextContent(record.data));
  }
  return texts;
}

function findStructuredMatch(
  value: unknown,
  citeKey: string
): { corpusPaperId: string | null; corpusPaperTitle: string | null } | null {
  const keyLower = citeKey.toLowerCase();
  const record = asRecord(value);
  const results = Array.isArray(value)
    ? value
    : Array.isArray(record?.results)
      ? record.results
      : [];

  const match = results.find((entry) => {
    const candidate = asRecord(entry);
    if (!candidate) {
      return false;
    }
    const id = typeof candidate.id === "string" ? candidate.id.toLowerCase() : "";
    const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
    const aliases = Array.isArray(candidate.aliases) ? candidate.aliases : [];
    return (
      id.includes(keyLower) ||
      name.includes(keyLower) ||
      aliases.some(
        (alias) => typeof alias === "string" && alias.toLowerCase().includes(keyLower)
      )
    );
  });

  const matchedRecord = asRecord(match);
  if (!matchedRecord) {
    return null;
  }
  return {
    corpusPaperId: typeof matchedRecord.id === "string" ? matchedRecord.id : null,
    corpusPaperTitle:
      typeof matchedRecord.name === "string" ? matchedRecord.name : null,
  };
}

function findRenderedQueryMatch(
  value: unknown
): { corpusPaperId: string | null; corpusPaperTitle: string | null } | null {
  const text = collectTextContent(value).join("\n").trim();
  if (!text || /No graph matches found for /i.test(text) || !/Results for "/i.test(text)) {
    return null;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("•")) {
      continue;
    }
    const body = trimmed.replace(/^•\s*/, "").trim();
    if (!body) {
      continue;
    }
    const separatorIndex = body.indexOf(":");
    const nodeName =
      separatorIndex >= 0 ? body.slice(separatorIndex + 1).trim() : body;
    if (!nodeName) {
      continue;
    }
    return {
      corpusPaperId: null,
      corpusPaperTitle: nodeName,
    };
  }

  return {
    corpusPaperId: null,
    corpusPaperTitle: null,
  };
}

// ---------------------------------------------------------------------------
// Parse \cite{} keys from LaTeX source
// ---------------------------------------------------------------------------

export function parseCiteKeysFromLatex(source: string): string[] {
  const keys = new Set<string>();
  // Match \cite{key1,key2}, \citep{key}, \citet{key}, \citeauthor{key}, etc.
  const pattern = /\\cite[ptba]?\*?\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[1];
    for (const key of raw.split(",")) {
      const trimmed = key.trim();
      if (trimmed.length > 0) {
        keys.add(trimmed);
      }
    }
  }
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Ground citations against PaperNexus corpus
// ---------------------------------------------------------------------------

export async function groundCitationsInGraph(params: {
  projectRoot: string;
  draftPath: string;
  mcpClient: McpClientLike | null;
  reportPath?: string | null;
}): Promise<CitationGroundingResult> {
  const { projectRoot, draftPath, mcpClient } = params;

  // Read the LaTeX draft
  const resolvedDraftPath = resolveProjectArtifactPath(projectRoot, draftPath);
  const draftContent = await readTextIfExists(resolvedDraftPath);
  if (!draftContent) {
    const reportArtifactPath =
      params.reportPath ?? "academic_writer/CITATION_GROUND_REPORT.md";
    const reportResolved = path.join(path.resolve(projectRoot), reportArtifactPath);
    await writeTextEnsured(
      reportResolved,
      "# Citation Grounding Report\n\nNo draft content found at " + draftPath + ".\n"
    );
    return {
      entries: [],
      verifiedCount: 0,
      unverifiedCount: 0,
      totalCitations: 0,
      reportPath: reportArtifactPath,
    };
  }

  const citeKeys = parseCiteKeysFromLatex(draftContent);
  const entries: CitationGroundingEntry[] = [];

  for (const key of citeKeys) {
    if (!mcpClient) {
      entries.push({
        citeKey: key,
        found: false,
        corpusPaperId: null,
        corpusPaperTitle: null,
        status: "UNVERIFIED",
      });
      continue;
    }

    const result = await mcpClient.callTool("query", {
      query: key,
      layers: "DocumentLayer",
      limit: 3,
    });

    if (result.ok && result.data) {
      const match =
        findStructuredMatch(result.data, key) ?? findRenderedQueryMatch(result.data);

      if (match) {
        entries.push({
          citeKey: key,
          found: true,
          corpusPaperId: match.corpusPaperId,
          corpusPaperTitle: match.corpusPaperTitle,
          status: "VERIFIED",
        });
      } else {
        entries.push({
          citeKey: key,
          found: false,
          corpusPaperId: null,
          corpusPaperTitle: null,
          status: "UNVERIFIED",
        });
      }
    } else {
      entries.push({
        citeKey: key,
        found: false,
        corpusPaperId: null,
        corpusPaperTitle: null,
        status: "UNVERIFIED",
      });
    }
  }

  const verified = entries.filter((e) => e.status === "VERIFIED");
  const unverified = entries.filter((e) => e.status === "UNVERIFIED");

  // Write report
  const report = `# Citation Grounding Report

**Draft:** ${draftPath}
**Total citations:** ${entries.length}
**Verified:** ${verified.length}
**Unverified:** ${unverified.length}

## Verified Citations

${verified.length > 0 ? verified.map((e) => `- \`${e.citeKey}\` → ${e.corpusPaperTitle ?? e.corpusPaperId ?? "matched"}`).join("\n") : "- none"}

## Unverified Citations

${unverified.length > 0 ? unverified.map((e) => `- \`${e.citeKey}\` — NOT FOUND in PaperNexus corpus`).join("\n") : "- none (all citations verified)"}

${unverified.length > 0 ? `\n> **Warning:** ${unverified.length} citation(s) could not be verified against the PaperNexus corpus. These must be resolved before SUBMIT.\n` : ""}`;

  const reportArtifactPath =
    params.reportPath ?? "academic_writer/CITATION_GROUND_REPORT.md";
  const reportResolved = path.join(path.resolve(projectRoot), reportArtifactPath);
  await writeTextEnsured(reportResolved, report);

  return {
    entries,
    verifiedCount: verified.length,
    unverifiedCount: unverified.length,
    totalCitations: entries.length,
    reportPath: reportArtifactPath,
  };
}
