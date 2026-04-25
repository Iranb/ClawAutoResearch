import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import { writeJsonEnsured } from "./workflow-guard-core/fs";
import type {
  PaperIngestionQueuedRequest,
  PaperIngestionQueuedRequestKind,
} from "./workflow-guard";
import {
  buildPapernexusBatchImportCommandText,
  buildPapernexusBatchImportWaitArgs,
  getPapernexusBatchImportArgs,
  isPapernexusBatchImportLifecycleRequest,
} from "./papernexus-batch-executor.js";

export type PaperIngestionValidationStatus =
  | "unknown"
  | "valid"
  | "warning"
  | "invalid";

export type PaperIngestionValidationIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

export type PaperIngestionValidationEntry = {
  paperId: string | null;
  sourcePath: string;
  resolvedPath: string;
  sourceKind: "markdown" | "pdf" | "unknown";
  status: PaperIngestionValidationStatus;
  sizeBytes: number | null;
  issues: PaperIngestionValidationIssue[];
};

export type PaperIngestionValidationReport = {
  requestId: string;
  requestKind: PaperIngestionQueuedRequestKind | null;
  checkedAt: string;
  manifestPath: string | null;
  reportPath: string;
  status: PaperIngestionValidationStatus;
  summary: string;
  entryCount: number;
  validCount: number;
  warningCount: number;
  invalidCount: number;
  entries: PaperIngestionValidationEntry[];
};

type StagedPaperReference = {
  paperId: string | null;
  sourcePath: string;
  resolvedPath: string;
  sourceKind: "markdown" | "pdf" | "unknown";
};

type ManifestInspection = {
  requestKind: PaperIngestionQueuedRequestKind | null;
  manifestPath: string | null;
  manifestRecord: Record<string, unknown> | null;
  references: StagedPaperReference[];
  selectedPaperCount: number;
};

const HTML_STUB_PATTERNS = [
  /<!doctype html/i,
  /<html[\s>]/i,
  /access denied/i,
  /403 forbidden/i,
  /404 not found/i,
  /captcha/i,
  /cloudflare/i,
  /just a moment/i,
  /sign in to continue/i,
  /temporarily unavailable/i,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry)))
  );
}

function normalizeSourceKind(value: string | null | undefined): "markdown" | "pdf" | "unknown" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }
  if (normalized === "pdf") {
    return "pdf";
  }
  return "unknown";
}

function resolveImportPath(params: {
  projectRoot: string;
  targetPath: string | null;
  baseDir?: string | null;
}): string | null {
  if (!params.targetPath) {
    return null;
  }
  if (path.isAbsolute(params.targetPath)) {
    return path.resolve(params.targetPath);
  }
  if (params.baseDir) {
    return path.resolve(params.baseDir, params.targetPath);
  }
  return (
    resolveProjectArtifactPath(params.projectRoot, params.targetPath) ??
    path.resolve(params.projectRoot, params.targetPath)
  );
}

function inferSourceKind(params: {
  explicit: string | null | undefined;
  sourcePath: string;
}): "markdown" | "pdf" | "unknown" {
  const explicit = normalizeSourceKind(params.explicit);
  if (explicit !== "unknown") {
    return explicit;
  }
  const lower = params.sourcePath.toLowerCase();
  if (lower.endsWith(".md")) {
    return "markdown";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  return "unknown";
}

function readFlagValue(args: string[], flag: string): string | null {
  const index = args.findIndex((entry) => entry === flag);
  if (index < 0) {
    return null;
  }
  return args[index + 1] ?? null;
}

function stripQuotedShellToken(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function extractFlagFromCommandText(commandText: string | null, flag: string): string | null {
  if (!commandText) {
    return null;
  }
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedFlag}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`, "i");
  const match = commandText.match(regex);
  if (!match) {
    return null;
  }
  return stripQuotedShellToken(match[1] ?? match[2] ?? match[3] ?? "");
}

function normalizeQueuedRequestKind(
  value: unknown
): PaperIngestionQueuedRequestKind | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "upload_manifest":
    case "direct_source":
    case "requisition":
      return normalized;
    default:
      return null;
  }
}

function inferQueuedRequestKind(params: {
  explicit?: unknown;
  triggerKind?: string | null;
  manifestPath?: string | null;
  commandText?: string | null;
  wrapper?: string | null;
}): PaperIngestionQueuedRequestKind | null {
  const explicit = normalizeQueuedRequestKind(params.explicit);
  if (explicit) {
    return explicit;
  }
  const triggerKind = String(params.triggerKind ?? "").trim().toLowerCase();
  if (
    triggerKind === "idea_catalyst_requisition" ||
    triggerKind === "literature_discovery" ||
    triggerKind.endsWith("literature_discovery")
  ) {
    return "requisition";
  }
  if (params.manifestPath) {
    return "upload_manifest";
  }
  if (params.commandText || params.wrapper) {
    return "direct_source";
  }
  return null;
}

function isRequisitionManifestRecord(record: Record<string, unknown> | null): boolean {
  return Boolean(
    record &&
      (asRecord(record.literature_discovery) || asRecord(record.catalyst_requisition))
  );
}

async function readManifestInspection(params: {
  projectRoot: string;
  request: PaperIngestionQueuedRequest;
}): Promise<ManifestInspection | null> {
  if (!params.request.manifestPath) {
    return null;
  }
  const manifestResolvedPath = resolveImportPath({
    projectRoot: params.projectRoot,
    targetPath: params.request.manifestPath,
  });
  if (!manifestResolvedPath) {
    return {
      requestKind: inferQueuedRequestKind({
        explicit: params.request.requestKind,
        triggerKind: params.request.triggerKind,
        manifestPath: params.request.manifestPath,
        commandText: params.request.commandText,
        wrapper: params.request.wrapper,
      }),
      manifestPath: null,
      manifestRecord: null,
      references: [],
      selectedPaperCount: 0,
    };
  }

  let raw: unknown = null;
  try {
    raw = JSON.parse(await fs.readFile(manifestResolvedPath, "utf8"));
  } catch {
    return {
      requestKind: inferQueuedRequestKind({
        explicit: params.request.requestKind,
        triggerKind: params.request.triggerKind,
        manifestPath: params.request.manifestPath,
        commandText: params.request.commandText,
        wrapper: params.request.wrapper,
      }),
      manifestPath: manifestResolvedPath,
      manifestRecord: null,
      references: [],
      selectedPaperCount: 0,
    };
  }

  const record = asRecord(raw) ?? {};
  const paperList = Array.isArray(record.papers)
    ? record.papers
    : Array.isArray(record.entries)
      ? record.entries
      : Array.isArray(raw)
        ? raw
        : [];
  const manifestDir = path.dirname(manifestResolvedPath);
  const references = paperList
    .map((entry) => {
      const paperRecord = asRecord(entry);
      if (!paperRecord) {
        return null;
      }
      const sourcePath =
        asString(
          paperRecord.source ??
            paperRecord.source_path ??
            paperRecord.sourcePath ??
            paperRecord.file ??
            paperRecord.file_path ??
            paperRecord.filePath
        ) ?? null;
      const resolvedPath = resolveImportPath({
        projectRoot: params.projectRoot,
        targetPath: sourcePath,
        baseDir: manifestDir,
      });
      if (!sourcePath || !resolvedPath) {
        return null;
      }
      return {
        paperId:
          asString(paperRecord.paperId ?? paperRecord.paper_id ?? paperRecord.canonical_id) ??
          null,
        sourcePath,
        resolvedPath,
        sourceKind: inferSourceKind({
          explicit: asString(paperRecord.sourceKind ?? paperRecord.source_kind),
          sourcePath,
        }),
      } satisfies StagedPaperReference;
    })
    .filter((entry): entry is StagedPaperReference => Boolean(entry));

  const requestKind = isRequisitionManifestRecord(record)
    ? "requisition"
    : inferQueuedRequestKind({
        explicit: params.request.requestKind,
        triggerKind: params.request.triggerKind,
        manifestPath: params.request.manifestPath,
        commandText: params.request.commandText,
        wrapper: params.request.wrapper,
      });
  const selectedPaperCount = Array.isArray(record.selected_papers)
    ? record.selected_papers.length
    : Array.isArray(asRecord(record.literature_discovery)?.selected_papers)
      ? (asRecord(record.literature_discovery)?.selected_papers as unknown[]).length
      : Array.isArray(asRecord(record.catalyst_requisition)?.selected_papers)
        ? (asRecord(record.catalyst_requisition)?.selected_papers as unknown[]).length
        : 0;
  return {
    requestKind,
    manifestPath: manifestResolvedPath,
    manifestRecord: record,
    references,
    selectedPaperCount,
  };
}

async function collectDirectSourceReferences(params: {
  projectRoot: string;
  request: PaperIngestionQueuedRequest;
}): Promise<StagedPaperReference[]> {
  const sourceFlag =
    readFlagValue(params.request.args, "--source") ??
    readFlagValue(params.request.args, "--input") ??
    extractFlagFromCommandText(params.request.commandText, "--source") ??
    extractFlagFromCommandText(params.request.commandText, "--input");
  const paperId =
    readFlagValue(params.request.args, "--paper-id") ??
    extractFlagFromCommandText(params.request.commandText, "--paper-id") ??
    null;
  const resolvedPath = resolveImportPath({
    projectRoot: params.projectRoot,
    targetPath: sourceFlag,
  });
  if (!sourceFlag || !resolvedPath) {
    return [];
  }
  return [
    {
      paperId,
      sourcePath: sourceFlag,
      resolvedPath,
      sourceKind: inferSourceKind({
        explicit: null,
        sourcePath: sourceFlag,
      }),
    },
  ];
}

async function collectStagedPaperReferences(params: {
  projectRoot: string;
  request: PaperIngestionQueuedRequest;
  manifestInspection?: ManifestInspection | null;
}): Promise<StagedPaperReference[]> {
  const manifestRefs = params.manifestInspection?.references ?? [];
  if (manifestRefs.length > 0) {
    return manifestRefs;
  }
  return collectDirectSourceReferences(params);
}

async function validateMarkdownFile(targetPath: string): Promise<{
  sizeBytes: number;
  issues: PaperIngestionValidationIssue[];
}> {
  const issues: PaperIngestionValidationIssue[] = [];
  const raw = await fs.readFile(targetPath, "utf8");
  const sizeBytes = Buffer.byteLength(raw, "utf8");
  const normalized = raw.trim();
  if (sizeBytes < 512) {
    issues.push({
      code: "markdown_too_small",
      severity: "error",
      message: "Markdown file is too small to be a reliable paper source.",
    });
  }
  if (HTML_STUB_PATTERNS.some((pattern) => pattern.test(normalized))) {
    issues.push({
      code: "html_stub_detected",
      severity: "error",
      message: "Markdown looks like an HTML/login/error stub instead of paper content.",
    });
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount < 120) {
    issues.push({
      code: "markdown_word_count_low",
      severity: "warning",
      message: "Markdown content is unusually short and may be truncated.",
    });
  }
  if (!/[A-Za-z]{4,}/.test(normalized)) {
    issues.push({
      code: "markdown_not_textual",
      severity: "error",
      message: "Markdown does not contain enough readable text to support ingestion.",
    });
  }
  return { sizeBytes, issues };
}

async function validatePdfFile(targetPath: string): Promise<{
  sizeBytes: number;
  issues: PaperIngestionValidationIssue[];
}> {
  const issues: PaperIngestionValidationIssue[] = [];
  const buffer = await fs.readFile(targetPath);
  const sizeBytes = buffer.byteLength;
  if (sizeBytes < 2048) {
    issues.push({
      code: "pdf_too_small",
      severity: "error",
      message: "PDF file is too small to be a plausible paper PDF.",
    });
  }
  const header = buffer.subarray(0, 8).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    issues.push({
      code: "pdf_header_missing",
      severity: "error",
      message: "PDF header is missing; staged file is not a valid PDF.",
    });
  }
  return { sizeBytes, issues };
}

function summarizeValidation(report: {
  entryCount: number;
  validCount: number;
  warningCount: number;
  invalidCount: number;
}): string {
  if (report.entryCount === 0) {
    return "No staged paper sources were discoverable from the queued request.";
  }
  return `Validated ${report.entryCount} staged paper source(s): ${report.validCount} valid, ${report.warningCount} warning, ${report.invalidCount} invalid.`;
}

function summarizeRequisitionValidation(params: {
  request: PaperIngestionQueuedRequest;
  selectedPaperCount: number;
}): string {
  const triggerKind = String(params.request.triggerKind ?? "").trim().toLowerCase();
  const label =
    triggerKind === "idea_catalyst_requisition"
      ? "IDEA-CATALYST requisition"
      : "Literature discovery requisition";
  return params.selectedPaperCount > 0
    ? `${label} is not an upload manifest yet; ${params.selectedPaperCount} selected paper(s) still need a real batch manifest with staged sources before PaperNexus import can launch.`
    : `${label} is waiting for paper selection and staging; upload validation was skipped because no real batch manifest exists yet.`;
}

export function defaultPaperIngestionMaxAttempts(): number {
  return 3;
}

export function isQueuedPaperIngestionRetryDue(
  request: Pick<PaperIngestionQueuedRequest, "status" | "deadLetterAt" | "nextRetryAt">,
  nowIso: string
): boolean {
  if (!["queued", "needs_repair"].includes(request.status)) {
    return false;
  }
  if (request.deadLetterAt) {
    return false;
  }
  if (!request.nextRetryAt) {
    return true;
  }
  return Date.parse(request.nextRetryAt) <= Date.parse(nowIso);
}

function computeRetryBackoffMinutes(attemptCount: number): number {
  if (attemptCount <= 1) {
    return 5;
  }
  if (attemptCount === 2) {
    return 15;
  }
  return 60;
}

function computeNextRetryAt(nowIso: string, attemptCount: number): string {
  return new Date(
    Date.parse(nowIso) + computeRetryBackoffMinutes(attemptCount) * 60_000
  ).toISOString();
}

function hasValidationErrors(report: PaperIngestionValidationReport): boolean {
  return report.invalidCount > 0;
}

export function applyPaperIngestionValidationToRequest(params: {
  request: PaperIngestionQueuedRequest;
  report: PaperIngestionValidationReport;
  nowIso?: string;
}): PaperIngestionQueuedRequest {
  const nowIso = params.nowIso ?? params.report.checkedAt;
  const blocked = hasValidationErrors(params.report);
  return {
    ...params.request,
    requestKind: params.report.requestKind ?? params.request.requestKind,
    status:
      blocked && params.request.status === "queued"
        ? "needs_repair"
        : params.request.status,
    updatedAt: nowIso,
    validationStatus: params.report.status,
    validationSummary: params.report.summary,
    validationReportPath: params.report.reportPath,
    detail:
      blocked && !params.request.deadLetterAt
        ? `Staged paper validation blocked launch: ${params.report.summary}`
        : params.request.detail,
  };
}

export function markQueuedPaperIngestionLaunchFailure(params: {
  request: PaperIngestionQueuedRequest;
  nowIso: string;
  error: string;
}): PaperIngestionQueuedRequest {
  const nextAttemptCount = (params.request.attemptCount ?? 0) + 1;
  const maxAttempts = params.request.maxAttempts ?? defaultPaperIngestionMaxAttempts();
  const exhausted = nextAttemptCount >= maxAttempts;
  return {
    ...params.request,
    status: exhausted ? "failed" : "needs_repair",
    updatedAt: params.nowIso,
    lastAttemptAt: params.nowIso,
    attemptCount: nextAttemptCount,
    maxAttempts,
    nextRetryAt: exhausted ? null : computeNextRetryAt(params.nowIso, nextAttemptCount),
    lastError: params.error,
    deadLetterAt: exhausted ? params.nowIso : params.request.deadLetterAt,
    deadLetterReason: exhausted ? params.error : params.request.deadLetterReason,
    detail: exhausted
      ? `Retry budget exhausted; request moved to dead-letter queue: ${params.error}`
      : `Upload launch blocked; retry scheduled after validation/repair: ${params.error}`,
  };
}

export function markQueuedPaperIngestionLaunchStarted(params: {
  request: PaperIngestionQueuedRequest;
  nowIso: string;
  runId: string | null;
  sessionKey: string | null;
  triggerKind: string;
  summary: string | null;
}): PaperIngestionQueuedRequest {
  const nextAttemptCount = (params.request.attemptCount ?? 0) + 1;
  return {
    ...params.request,
    status: "running",
    updatedAt: params.nowIso,
    startedAt: params.nowIso,
    lastAttemptAt: params.nowIso,
    attemptCount: nextAttemptCount,
    maxAttempts: params.request.maxAttempts ?? defaultPaperIngestionMaxAttempts(),
    nextRetryAt: null,
    lastRunId: params.runId,
    lastSessionKey: params.sessionKey,
    lastError: null,
    triggerKind: params.triggerKind,
    detail:
      params.summary ??
      `Workflow-triggered upload started from ${params.triggerKind}.`,
  };
}

export function finalizeQueuedPaperIngestionAttempt(params: {
  request: PaperIngestionQueuedRequest;
  terminalStatus: "completed" | "failed" | "needs_repair";
  finishedAt: string;
  error: string | null;
}): PaperIngestionQueuedRequest {
  if (params.terminalStatus === "completed") {
    if (isPapernexusBatchImportLifecycleRequest(params.request)) {
      const waitArgs = buildPapernexusBatchImportWaitArgs(
        getPapernexusBatchImportArgs(params.request),
        {
          timeoutSeconds: 60,
          intervalSeconds: 5,
        }
      );
      return {
        ...params.request,
        status: "queued",
        args: waitArgs,
        commandText: buildPapernexusBatchImportCommandText(waitArgs),
        updatedAt: params.finishedAt,
        finishedAt: params.request.finishedAt,
        nextRetryAt: null,
        deadLetterAt: null,
        deadLetterReason: null,
        lastError: null,
        detail:
          "PaperNexus wrapper process finished, but remote import completion is not implied by process exit; workflow requeued a bounded wait/status pass.",
      };
    }
    return {
      ...params.request,
      status: "completed",
      updatedAt: params.finishedAt,
      finishedAt: params.finishedAt,
      nextRetryAt: null,
      deadLetterAt: null,
      deadLetterReason: null,
      lastError: null,
      detail:
        "Workflow observed that the delegated PaperNexus wrapper pass finished. Upload execution is no longer running in the background.",
    };
  }
  const maxAttempts = params.request.maxAttempts ?? defaultPaperIngestionMaxAttempts();
  const exhausted = (params.request.attemptCount ?? 0) >= maxAttempts;
  const retryReason =
    params.error ??
    (params.terminalStatus === "failed"
      ? "Wrapper run failed."
      : "Wrapper run needs repair.");
  return {
    ...params.request,
    status: exhausted ? "failed" : "needs_repair",
    updatedAt: params.finishedAt,
    finishedAt: params.finishedAt,
    nextRetryAt: exhausted
      ? null
      : computeNextRetryAt(params.finishedAt, params.request.attemptCount ?? 0),
    lastError: retryReason,
    deadLetterAt: exhausted ? params.finishedAt : params.request.deadLetterAt,
    deadLetterReason: exhausted ? retryReason : params.request.deadLetterReason,
    detail: exhausted
      ? `Retry budget exhausted; request moved to dead-letter queue: ${retryReason}`
      : `Wrapper run ended in ${params.terminalStatus}; queued for bounded repair: ${retryReason}`,
  };
}

export async function validateQueuedPaperIngestionRequest(params: {
  projectRoot: string;
  request: PaperIngestionQueuedRequest;
}): Promise<PaperIngestionValidationReport> {
  const checkedAt = new Date().toISOString();
  const reportPath = path.join(
    params.projectRoot,
    "graph",
    "paper-ingestion-validation",
    `${params.request.requestId}.json`
  );
  const manifestInspection = await readManifestInspection(params);
  const requestKind =
    manifestInspection?.requestKind ??
    inferQueuedRequestKind({
      explicit: params.request.requestKind,
      triggerKind: params.request.triggerKind,
      manifestPath: params.request.manifestPath,
      commandText: params.request.commandText,
      wrapper: params.request.wrapper,
    });
  const references = await collectStagedPaperReferences({
    ...params,
    manifestInspection,
  });
  const entries: PaperIngestionValidationEntry[] = [];
  if (requestKind === "requisition") {
    entries.push({
      paperId: null,
      sourcePath: params.request.manifestPath ?? params.request.commandText ?? "<requisition>",
      resolvedPath:
        manifestInspection?.manifestPath ??
        params.request.manifestPath ??
        params.request.commandText ??
        "<requisition>",
      sourceKind: "unknown",
      status:
        manifestInspection?.manifestRecord != null || !params.request.manifestPath
          ? "warning"
          : "invalid",
      sizeBytes: null,
      issues: [
        {
          code:
            manifestInspection?.manifestRecord != null || !params.request.manifestPath
              ? "requisition_not_upload_ready"
              : "manifest_unreadable_or_empty",
          severity:
            manifestInspection?.manifestRecord != null || !params.request.manifestPath
              ? "warning"
              : "error",
          message:
            manifestInspection?.manifestRecord != null || !params.request.manifestPath
              ? summarizeRequisitionValidation({
                  request: params.request,
                  selectedPaperCount: manifestInspection?.selectedPaperCount ?? 0,
                })
              : "Requisition file could not be read or parsed, so workflow-owned graph enrichment cannot continue yet.",
        },
      ],
    });
  } else if (params.request.manifestPath && references.length === 0) {
    const resolvedManifestPath =
      manifestInspection?.manifestPath ??
      resolveImportPath({
        projectRoot: params.projectRoot,
        targetPath: params.request.manifestPath,
      });
    entries.push({
      paperId: null,
      sourcePath: params.request.manifestPath,
      resolvedPath: resolvedManifestPath ?? params.request.manifestPath,
      sourceKind: "unknown",
      status: "invalid",
      sizeBytes: null,
      issues: [
        {
          code: "manifest_unreadable_or_empty",
          severity: "error",
          message:
            "Batch manifest could not be read, was invalid JSON, or did not contain any staged paper sources.",
        },
      ],
    });
  }
  for (const reference of references) {
    const issues: PaperIngestionValidationIssue[] = [];
    let sizeBytes: number | null = null;
    try {
      await fs.access(reference.resolvedPath);
    } catch {
      issues.push({
        code: "source_missing",
        severity: "error",
        message: "Staged source file does not exist.",
      });
      entries.push({
        paperId: reference.paperId,
        sourcePath: reference.sourcePath,
        resolvedPath: reference.resolvedPath,
        sourceKind: reference.sourceKind,
        status: "invalid",
        sizeBytes,
        issues,
      });
      continue;
    }

    if (reference.sourceKind === "markdown") {
      const markdownCheck = await validateMarkdownFile(reference.resolvedPath);
      sizeBytes = markdownCheck.sizeBytes;
      issues.push(...markdownCheck.issues);
    } else if (reference.sourceKind === "pdf") {
      const pdfCheck = await validatePdfFile(reference.resolvedPath);
      sizeBytes = pdfCheck.sizeBytes;
      issues.push(...pdfCheck.issues);
    } else {
      const stat = await fs.stat(reference.resolvedPath);
      sizeBytes = stat.size;
      issues.push({
        code: "unknown_source_kind",
        severity: "warning",
        message: "Source kind is unknown; validation used only file existence and size.",
      });
    }

    const hasError = issues.some((issue) => issue.severity === "error");
    const hasWarning = issues.some((issue) => issue.severity === "warning");
    entries.push({
      paperId: reference.paperId,
      sourcePath: reference.sourcePath,
      resolvedPath: reference.resolvedPath,
      sourceKind: reference.sourceKind,
      status: hasError ? "invalid" : hasWarning ? "warning" : "valid",
      sizeBytes,
      issues,
    });
  }

  const validCount = entries.filter((entry) => entry.status === "valid").length;
  const warningCount = entries.filter((entry) => entry.status === "warning").length;
  const invalidCount = entries.filter((entry) => entry.status === "invalid").length;
  const status: PaperIngestionValidationStatus =
    entries.length === 0
      ? "warning"
      : invalidCount > 0
        ? "invalid"
        : warningCount > 0
          ? "warning"
          : "valid";
  const report: PaperIngestionValidationReport = {
    requestId: params.request.requestId,
    requestKind,
    checkedAt,
    manifestPath: params.request.manifestPath,
    reportPath,
    status,
    summary:
      requestKind === "requisition"
        ? summarizeRequisitionValidation({
            request: params.request,
            selectedPaperCount: manifestInspection?.selectedPaperCount ?? 0,
          })
        : summarizeValidation({
            entryCount: entries.length,
            validCount,
            warningCount,
            invalidCount,
          }),
    entryCount: entries.length,
    validCount,
    warningCount,
    invalidCount,
    entries,
  };
  await writeJsonEnsured(reportPath, report);
  return report;
}
