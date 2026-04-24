import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  normalizeArxivId,
  normalizeProviderName,
  serializeCanonicalPaperRecord,
} from "../paper-source-contract";
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

function isRemoteHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const target = new URL(value);
    return target.protocol === "http:" || target.protocol === "https:";
  } catch {
    return false;
  }
}

function arxivPdfUrlFromId(value: string | null | undefined): string | null {
  const arxivId = normalizeArxivId(value);
  return arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;
}

function arxivPdfUrlFromRemoteUrl(value: string | null | undefined): string | null {
  if (!isRemoteHttpUrl(value)) {
    return null;
  }
  const target = new URL(value);
  if (!/(^|\.)arxiv\.org$/i.test(target.hostname)) {
    return null;
  }
  const parts = target.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || (parts[0] !== "abs" && parts[0] !== "pdf")) {
    return null;
  }
  return arxivPdfUrlFromId(parts.slice(1).join("/").replace(/\.pdf$/i, ""));
}

function looksLikePdfDownloadUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const target = new URL(value);
    const pathname = target.pathname.toLowerCase();
    return (
      pathname.endsWith(".pdf") ||
      (/(\.|^)arxiv\.org$/i.test(target.hostname) && pathname.startsWith("/pdf/"))
    );
  } catch {
    return value.toLowerCase().includes(".pdf");
  }
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (!isRemoteHttpUrl(raw)) {
      continue;
    }
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function collectDownloadCandidates(candidate: MergedPaperCandidate): string[] {
  const directPdfUrls = [candidate.pdfUrl, candidate.sourcePath].filter((value) =>
    isRemoteHttpUrl(value)
  );
  const pdfLikeHints = [
    candidate.bestOaUrl,
    ...candidate.sourceHints,
  ].filter((value) => looksLikePdfDownloadUrl(value));
  const arxivDerivedUrls = [
    arxivPdfUrlFromId(candidate.arxivId),
    arxivPdfUrlFromRemoteUrl(candidate.pdfUrl),
    arxivPdfUrlFromRemoteUrl(candidate.bestOaUrl),
    ...candidate.sourceHints.map((hint) => arxivPdfUrlFromRemoteUrl(hint)),
  ];
  return uniqueUrls([
    ...directPdfUrls,
    ...pdfLikeHints,
    ...arxivDerivedUrls,
  ]);
}

function shouldMarkUnresolved(candidate: MergedPaperCandidate): boolean {
  return !candidate.sourcePath || isRemoteHttpUrl(candidate.sourcePath);
}

function unresolvedStatus(
  candidate: MergedPaperCandidate,
  attempted: boolean
): MergedPaperCandidate["resolutionStatus"] {
  if (!shouldMarkUnresolved(candidate)) {
    return candidate.resolutionStatus;
  }
  return attempted ? "resolution_failed" : "metadata_only_unresolved";
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
  let attemptedCandidateCount = 0;

  for (const candidate of params.candidates) {
    const next: MergedPaperCandidate = {
      ...candidate,
      resolutionAttempts: [...candidate.resolutionAttempts],
    };
    if (candidate.sourcePath && !isRemoteHttpUrl(candidate.sourcePath)) {
      resolvedCandidates.push(next);
      continue;
    }
    const downloadCandidates = collectDownloadCandidates(candidate);
    const shouldAttempt = downloadCandidates.length > 0 && attemptedCandidateCount < maxCandidates;
    if (shouldAttempt) {
      attemptedCandidateCount += 1;
    }
    let resolved = false;
    for (const url of shouldAttempt ? downloadCandidates : []) {
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
    if (!resolved && candidate.doi && attemptedCandidateCount < maxCandidates) {
      attemptedCandidateCount += 1;
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
    if (!resolved && shouldMarkUnresolved(next)) {
      next.resolutionStatus = unresolvedStatus(
        next,
        next.resolutionAttempts.some((attempt) => attempt.status === "failed")
      );
      next.metadataOnly = true;
    }
    resolvedCandidates.push(next);
  }

  return {
    candidates: resolvedCandidates,
    unresolved: resolvedCandidates.filter(
      (entry) =>
        entry.resolutionStatus === "metadata_only_unresolved" ||
        entry.resolutionStatus === "resolution_failed"
    ),
  };
}

export function serializeUnresolvedCandidates(candidates: MergedPaperCandidate[]) {
  return candidates.map((candidate) => serializeCanonicalPaperRecord(candidate));
}
