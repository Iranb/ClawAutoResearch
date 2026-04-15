import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizeProviderName, serializeCanonicalPaperRecord } from "../paper-source-contract";
import type { MergedPaperCandidate } from "./merge";
import { resolveWithUnpaywall } from "./provider-unpaywall";

const HTML_MARKERS = ["<!doctype html", "<html", "<head", "<body", "<script", "<title>"];
const ERROR_MARKERS = [
  "access denied",
  "forbidden",
  "not found",
  "404",
  "429",
  "too many requests",
  "just a moment",
  "cloudflare",
  "bad gateway",
  "gateway timeout",
  "service unavailable",
  "please enable javascript",
];

function slugifyCanonicalId(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function looksLikeHtmlOrError(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, " ");
  return HTML_MARKERS.some((entry) => compact.includes(entry)) ||
    ERROR_MARKERS.some((entry) => compact.includes(entry));
}

function validatePdfBuffer(buffer: Buffer): { valid: boolean; reason: string } {
  if (buffer.length < 512) {
    return { valid: false, reason: "too_small" };
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { valid: true, reason: "pdf_header_ok" };
  }
  const preview = buffer.subarray(0, 4096).toString("utf8").trim().toLowerCase();
  if (looksLikeHtmlOrError(preview)) {
    return { valid: false, reason: "html_or_error_page" };
  }
  return { valid: false, reason: "missing_pdf_header" };
}

async function downloadPdf(params: {
  url: string;
  outputPath: string;
  signal?: AbortSignal;
}): Promise<{ success: boolean; reason: string }> {
  const response = await fetch(params.url, {
    signal: params.signal,
    headers: {
      "User-Agent": "ClawAutoResearch/1.0 (+https://github.com/Iranb/ClawAutoResearch)",
    },
  });
  if (!response.ok) {
    return { success: false, reason: `http_${response.status}` };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    return { success: false, reason: validation.reason };
  }
  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
  await fs.writeFile(params.outputPath, buffer);
  return { success: true, reason: validation.reason };
}

function looksLikePdfUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const target = new URL(value);
    const pathname = target.pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) {
      return true;
    }
  } catch {
    return value.toLowerCase().includes(".pdf");
  }
  return false;
}

export async function resolveMergedCandidatesToStaging(params: {
  projectRoot: string;
  candidates: MergedPaperCandidate[];
  maxCandidates?: number;
  signal?: AbortSignal;
}): Promise<{
  candidates: MergedPaperCandidate[];
  unresolved: MergedPaperCandidate[];
}> {
  const maxCandidates =
    typeof params.maxCandidates === "number" && Number.isFinite(params.maxCandidates)
      ? Math.max(1, Math.floor(params.maxCandidates))
      : 12;
  const stagingRoot = path.join(params.projectRoot, "researcher", "paper-staging", "pdf");
  const resolvedCandidates: MergedPaperCandidate[] = [];

  for (const candidate of params.candidates) {
    const next: MergedPaperCandidate = {
      ...candidate,
      resolutionAttempts: [...candidate.resolutionAttempts],
    };
    if (candidate.arxivId) {
      resolvedCandidates.push(next);
      continue;
    }
    const shouldAttempt =
      resolvedCandidates.filter((entry) => entry.sourcePath || entry.pdfUrl || entry.bestOaUrl).length <
      maxCandidates;
    if (!shouldAttempt) {
      resolvedCandidates.push(next);
      continue;
    }
    const directCandidates = [candidate.pdfUrl, candidate.bestOaUrl].filter(
      (value): value is string => Boolean(value)
    ).filter((value) => looksLikePdfUrl(value));
    let resolved = false;
    for (const url of directCandidates) {
      const outputPath = path.join(stagingRoot, `${slugifyCanonicalId(candidate.canonicalId)}.pdf`);
      const outcome = await downloadPdf({
        url,
        outputPath,
        signal: params.signal,
      });
      next.resolutionAttempts.push({
        provider: normalizeProviderName(candidate.sourceProvider),
        status: outcome.success ? "success" : "failed",
        detail: outcome.reason,
        at: new Date().toISOString(),
        url,
      });
      if (outcome.success) {
        next.sourceKind = "pdf";
        next.sourceProvider = candidate.sourceProvider ?? "pdf";
        next.sourcePath = outputPath;
        next.resolutionStatus = "resolved_pdf";
        next.metadataOnly = false;
        resolved = true;
        break;
      }
    }
    if (!resolved && candidate.doi) {
      const unpaywall = await resolveWithUnpaywall({
        doi: candidate.doi,
        signal: params.signal,
      });
      next.resolutionAttempts.push({
        provider: "unpaywall",
        status: unpaywall.status === "resolved" ? "success" : "failed",
        detail: unpaywall.error ?? unpaywall.status,
        at: new Date().toISOString(),
        url: unpaywall.pdfUrl ?? unpaywall.bestOaUrl,
      });
      if (unpaywall.bestOaUrl && !next.bestOaUrl) {
        next.bestOaUrl = unpaywall.bestOaUrl;
      }
      if (unpaywall.pdfUrl && !next.pdfUrl) {
        next.pdfUrl = unpaywall.pdfUrl;
        const outputPath = path.join(stagingRoot, `${slugifyCanonicalId(candidate.canonicalId)}.pdf`);
        const outcome = await downloadPdf({
          url: unpaywall.pdfUrl,
          outputPath,
          signal: params.signal,
        });
        next.resolutionAttempts.push({
          provider: "unpaywall",
          status: outcome.success ? "success" : "failed",
          detail: outcome.reason,
          at: new Date().toISOString(),
          url: unpaywall.pdfUrl,
        });
        if (outcome.success) {
          next.sourceKind = "pdf";
          next.sourceProvider = "unpaywall";
          next.sourcePath = outputPath;
          next.resolutionStatus = "resolved_pdf";
          next.metadataOnly = false;
          resolved = true;
        }
      }
    }
    if (!resolved && next.resolutionStatus === "unknown") {
      next.resolutionStatus = "metadata_only_unresolved";
      next.metadataOnly = true;
    }
    resolvedCandidates.push(next);
  }

  return {
    candidates: resolvedCandidates,
    unresolved: resolvedCandidates.filter(
      (entry) => entry.resolutionStatus === "metadata_only_unresolved"
    ),
  };
}

export function serializeUnresolvedCandidates(candidates: MergedPaperCandidate[]) {
  return candidates.map((candidate) => serializeCanonicalPaperRecord(candidate));
}
