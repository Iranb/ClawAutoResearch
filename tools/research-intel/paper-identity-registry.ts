import path from "node:path";
import {
  nowIso,
  readProjectJson,
  writeProjectJson,
} from "../research-contracts/core/project-io.ts";
import {
  normalizeWorkflowPaperSourceEntry,
  parseWorkflowPaperSourceIndex,
  type WorkflowPaperSourceEntry,
} from "../paper-source-index.ts";

export type CanonicalPaperMaturity =
  | "venue_published"
  | "openreview_accepted"
  | "preprint_with_metadata"
  | "source_only"
  | "uncertain";

export type CanonicalPaperIdentity = WorkflowPaperSourceEntry & {
  canonicalId: string;
  maturity: CanonicalPaperMaturity;
  preferredCitationSource: "venue" | "openreview" | "doi" | "arxiv" | "source";
  issues: string[];
};

export type PaperIdentityRegistry = {
  schemaVersion: number;
  generatedAt: string;
  sourceIndexPath: string;
  entries: CanonicalPaperIdentity[];
  counts: Record<CanonicalPaperMaturity, number>;
};

function inferMaturity(entry: WorkflowPaperSourceEntry): CanonicalPaperMaturity {
  const venue = (entry.venue ?? "").toLowerCase();
  const providers = entry.retrievalProviders.map((value) => value.toLowerCase());
  if (entry.doi || /cvpr|iccv|eccv|neurips|iclr|icml|aaai|tpami|ijcv|acl|emnlp|naacl|kdd/.test(venue)) {
    return "venue_published";
  }
  if (providers.some((value) => value.includes("openreview"))) {
    return "openreview_accepted";
  }
  if (entry.arxivId || entry.title || entry.year) {
    return "preprint_with_metadata";
  }
  if (entry.sourcePath) {
    return "source_only";
  }
  return "uncertain";
}

function preferredCitationSource(entry: WorkflowPaperSourceEntry, maturity: CanonicalPaperMaturity) {
  if (maturity === "venue_published" && entry.venue) {
    return "venue" as const;
  }
  if (maturity === "openreview_accepted") {
    return "openreview" as const;
  }
  if (entry.doi) {
    return "doi" as const;
  }
  if (entry.arxivId) {
    return "arxiv" as const;
  }
  return "source" as const;
}

function buildCanonicalId(entry: WorkflowPaperSourceEntry): string {
  if (entry.canonicalId) {
    return entry.canonicalId;
  }
  if (entry.doi) {
    return `doi:${entry.doi}`;
  }
  if (entry.arxivId) {
    return `arxiv:${entry.arxivId}`;
  }
  if (entry.normalizedTitle) {
    return `title:${entry.normalizedTitle}`;
  }
  if (entry.sourcePath) {
    return `source:${path.basename(entry.sourcePath).toLowerCase()}`;
  }
  return "paper:unknown";
}

function collectIssues(entry: WorkflowPaperSourceEntry, maturity: CanonicalPaperMaturity): string[] {
  const issues: string[] = [];
  if (!entry.title) {
    issues.push("missing_title");
  }
  if (!entry.year) {
    issues.push("missing_year");
  }
  if (maturity === "uncertain") {
    issues.push("uncertain_identity");
  }
  if (maturity === "preprint_with_metadata" && !entry.venue) {
    issues.push("preprint_only");
  }
  if ((entry.title ?? "").includes("Placeholder")) {
    issues.push("placeholder_title");
  }
  return issues;
}

export async function materializePaperIdentityRegistry(params: {
  projectRoot: string;
  sourceIndexPath?: string;
  outputPath?: string;
}): Promise<PaperIdentityRegistry> {
  const sourceIndexPath = params.sourceIndexPath ?? "researcher/PAPER_SOURCE_INDEX.json";
  const outputPath = params.outputPath ?? "researcher/PAPER_IDENTITY_REGISTRY.json";
  const raw = await readProjectJson<unknown>(params.projectRoot, sourceIndexPath);
  const entries = parseWorkflowPaperSourceIndex(raw).map((entry) => {
    const normalized = normalizeWorkflowPaperSourceEntry(entry);
    const maturity = inferMaturity(normalized);
    return {
      ...normalized,
      canonicalId: buildCanonicalId(normalized),
      maturity,
      preferredCitationSource: preferredCitationSource(normalized, maturity),
      issues: collectIssues(normalized, maturity),
    };
  });
  const uniqueEntries = Array.from(
    new Map(entries.map((entry) => [entry.canonicalId, entry])).values()
  ).sort((left, right) => (left.title ?? left.canonicalId).localeCompare(right.title ?? right.canonicalId));
  const counts: Record<CanonicalPaperMaturity, number> = {
    venue_published: 0,
    openreview_accepted: 0,
    preprint_with_metadata: 0,
    source_only: 0,
    uncertain: 0,
  };
  for (const entry of uniqueEntries) {
    counts[entry.maturity] += 1;
  }
  const registry: PaperIdentityRegistry = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    sourceIndexPath,
    entries: uniqueEntries,
    counts,
  };
  await writeProjectJson(params.projectRoot, outputPath, registry);
  return registry;
}
