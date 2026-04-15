import path from "node:path";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io.ts";
import { normalizeCitationIntegrityState, serializeCitationIntegrityState } from "../workflow-guard-state/authoring-review-state.ts";
import { materializePaperIdentityRegistry } from "./paper-identity-registry.ts";

export type CitationAuditReport = {
  schemaVersion: number;
  generatedAt: string;
  bibliographyPath: string | null;
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

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  return matches?.length ?? 0;
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
  const identityRegistry = await materializePaperIdentityRegistry({ projectRoot: params.projectRoot });
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
  const report: CitationAuditReport = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    bibliographyPath,
    verifiedCitationCount,
    unresolvedPlaceholderCount,
    suspiciousCitationCount,
    hallucinatedCitationCount,
    allCitationsReal:
      bibliographyText != null &&
      unresolvedPlaceholderCount === 0 &&
      hallucinatedCitationCount === 0,
    issues,
  };
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? "researcher/CITATION_AUDIT_REPORT.json",
    report
  );

  const nextState = {
    ...current,
    verificationStatus: report.allCitationsReal ? "verified" : "needs_revision",
    verificationReportPath: params.outputPath ?? "researcher/CITATION_AUDIT_REPORT.json",
    bibliographyPath,
    verifiedCitationCount,
    unresolvedPlaceholderCount,
    suspiciousCitationCount,
    hallucinatedCitationCount,
    allCitationsReal: report.allCitationsReal,
    bibliographyPageCount:
      bibliographyText == null ? 0 : Math.max(1, Math.ceil(bibliographyText.split(/\r?\n/).length / 45)),
    lastVerifiedAt: report.generatedAt,
    pendingReason: report.issues.length > 0 ? report.issues.join(", ") : null,
  };
  manifest.citation_integrity = serializeCitationIntegrityState(nextState);
  await writeProjectManifest(params.projectRoot, manifest);
  return report;
}
