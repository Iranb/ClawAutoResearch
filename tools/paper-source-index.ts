import {
  buildCanonicalPaperRecordFromRecord,
  type PaperResolutionStatus,
  type PaperSourceKind,
  type PaperVenueType,
} from "./paper-source-contract";
import {
  parsePaperSourceIndexEntries,
  readPaperSourceIndexForUpdate,
  resolvePaperSourceIndexPath,
} from "./paper-source-index-writer";

export type WorkflowPaperSourceEntry = {
  canonicalId: string | null;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  year: number | null;
  venue: string | null;
  venueFamily: string | null;
  venueType: PaperVenueType;
  venuePackHits: string[];
  venueAliasesMatched: string[];
  sourceKind: PaperSourceKind;
  sourceProvider: string | null;
  retrievalProviders: string[];
  sourcePath: string | null;
  citationCount: number | null;
  bestOaUrl: string | null;
  pdfUrl: string | null;
  resolutionStatus: PaperResolutionStatus;
};

export function normalizeWorkflowPaperSourceEntry(
  value: unknown
): WorkflowPaperSourceEntry {
  const record = buildCanonicalPaperRecordFromRecord(value);
  if (!record) {
    return {
      canonicalId: null,
      title: null,
      normalizedTitle: null,
      arxivId: null,
      doi: null,
      pmid: null,
      pmcid: null,
      year: null,
      venue: null,
      venueFamily: null,
      venueType: "unknown",
      venuePackHits: [],
      venueAliasesMatched: [],
      sourceKind: "unknown",
      sourceProvider: null,
      retrievalProviders: [],
      sourcePath: null,
      citationCount: null,
      bestOaUrl: null,
      pdfUrl: null,
      resolutionStatus: "unknown",
    };
  }
  return {
    canonicalId: record.canonicalId,
    title: record.title,
    normalizedTitle: record.normalizedTitle,
    arxivId: record.arxivId,
    doi: record.doi,
    pmid: record.pmid,
    pmcid: record.pmcid,
    year: record.year,
    venue: record.venue,
    venueFamily: record.venueFamily,
    venueType: record.venueType,
    venuePackHits: record.venuePackHits,
    venueAliasesMatched: record.venueAliasesMatched,
    sourceKind: record.sourceKind,
    sourceProvider: record.sourceProvider,
    retrievalProviders: record.retrievalProviders,
    sourcePath: record.sourcePath,
    citationCount: record.citationCount,
    bestOaUrl: record.bestOaUrl,
    pdfUrl: record.pdfUrl,
    resolutionStatus: record.resolutionStatus,
  };
}

export function parseWorkflowPaperSourceIndex(raw: unknown): WorkflowPaperSourceEntry[] {
  return parsePaperSourceIndexEntries(raw).map((entry) =>
    normalizeWorkflowPaperSourceEntry(entry)
  );
}

export async function readWorkflowPaperSourceIndex(params: {
  projectRoot: string;
}): Promise<{
  entries: WorkflowPaperSourceEntry[];
  sourceIndexPath: string;
}> {
  const sourceIndexPath = resolvePaperSourceIndexPath(params.projectRoot);
  const { entries } = await readPaperSourceIndexForUpdate({
    projectRoot: params.projectRoot,
  });
  return {
    entries: entries.map((entry) => normalizeWorkflowPaperSourceEntry(entry)),
    sourceIndexPath,
  };
}
