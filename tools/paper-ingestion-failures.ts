import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomicEnsured, writeTextEnsured } from "./workflow-guard-core/fs";
import { normalizePaperIngestionState } from "./workflow-guard-state/paper-ingestion";
import { buildPapernexusBatchImportCommandText } from "./papernexus-batch-executor.js";
import type {
  PaperIngestionFailedPaper,
  PaperIngestionState,
} from "./workflow-guard";

export type PaperIngestionFailureClassification = {
  retryable: boolean;
  retryReason: string;
  signature: string;
};

export type PaperIngestionRetryManifest = {
  schemaVersion: 1;
  projectId: string | null;
  corpus: string | null;
  retryMode: "sequential";
  intervalSeconds: number;
  maxAttempts: number;
  createdAt: string;
  createdBy: "workflow";
  sourceIndexSnapshot: string | null;
  graphPresenceSnapshot: string | null;
  items: Array<{
    paperId: string | null;
    title: string | null;
    sourceKey: string | null;
    inputPath: string | null;
    failureSignature: string | null;
    failureMessage: string | null;
    retryCount: number;
  }>;
};

const DEFAULT_RETRY_INTERVAL_SECONDS = 45;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const RETRY_MANIFEST_PATH = "graph/FAILED_PAPER_RETRY_MANIFEST.json";
const RETRY_REPORT_PATH = "graph/FAILED_PAPER_RETRY_REPORT.md";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeFailureText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function keyForFailure(value: PaperIngestionFailedPaper): string | null {
  return value.paperId ?? value.sourceKey ?? value.inputPath ?? value.title;
}

export function classifyPaperIngestionFailure(
  failureMessage: string | null | undefined
): PaperIngestionFailureClassification {
  const message = normalizeFailureText(failureMessage);
  if (
    /Source inputs changed/i.test(message) ||
    /committed newer corpus state/i.test(message) ||
    /lock conflict/i.test(message) ||
    /timeout|timed out/i.test(message) ||
    /\b5\d\d\b/.test(message)
  ) {
    return {
      retryable: true,
      retryReason: "transient_or_concurrent_papernexus_failure",
      signature: message || "transient_papernexus_failure",
    };
  }
  if (
    /invalid markdown/i.test(message) ||
    /missing source/i.test(message) ||
    /unsupported file/i.test(message) ||
    /validation failed/i.test(message) ||
    /parser validation/i.test(message)
  ) {
    return {
      retryable: false,
      retryReason: "non_retryable_source_validation_failure",
      signature: message || "source_validation_failure",
    };
  }
  return {
    retryable: true,
    retryReason: "unknown_failure_default_retry_once",
    signature: message || "unknown_papernexus_failure",
  };
}

export function collectPaperIngestionFailures(params: {
  state: PaperIngestionState;
}): PaperIngestionFailedPaper[] {
  const completedKeys = new Set(
    params.state.completedPapers
      .map((entry) => entry.canonicalId ?? entry.importTaskId ?? entry.title)
      .filter((entry): entry is string => Boolean(entry))
  );
  const failures: PaperIngestionFailedPaper[] = [...params.state.failedPapers];

  for (const item of params.state.batchItems) {
    if (!["failed", "submit_failed", "timed_out"].includes(String(item.status ?? ""))) {
      continue;
    }
    const message = item.error;
    const classification = classifyPaperIngestionFailure(message);
    const paper: PaperIngestionFailedPaper = {
      paperId: item.paperId ?? item.canonicalId,
      title: item.title,
      sourceKey: null,
      inputPath: null,
      failureSignature: classification.signature,
      failureMessage: message,
      failedAt: item.updatedAt,
      retryable: classification.retryable,
      retryReason: classification.retryReason,
      alreadyInGraph: completedKeys.has(item.paperId ?? "") ||
        completedKeys.has(item.canonicalId ?? "") ||
        completedKeys.has(item.importTaskId ?? "") ||
        completedKeys.has(item.title ?? ""),
      lastRetryAt: null,
      retryCount: 0,
    };
    failures.push(paper);
  }

  for (const operation of params.state.paperOperations) {
    if (!["failed", "timed_out"].includes(operation.status)) {
      continue;
    }
    const classification = classifyPaperIngestionFailure(operation.detail);
    failures.push({
      paperId: operation.canonicalId,
      title: operation.title,
      sourceKey: null,
      inputPath: null,
      failureSignature: classification.signature,
      failureMessage: operation.detail,
      failedAt: operation.finishedAt,
      retryable: classification.retryable,
      retryReason: classification.retryReason,
      alreadyInGraph: completedKeys.has(operation.canonicalId ?? "") ||
        completedKeys.has(operation.importTaskId ?? "") ||
        completedKeys.has(operation.title ?? ""),
      lastRetryAt: null,
      retryCount: 0,
    });
  }

  for (const request of params.state.queuedRequests) {
    if (!["failed", "needs_repair"].includes(request.status)) {
      continue;
    }
    const classification = classifyPaperIngestionFailure(
      request.lastError ?? request.detail ?? request.validationSummary
    );
    failures.push({
      paperId: null,
      title: request.summary,
      sourceKey: null,
      inputPath: request.manifestPath,
      failureSignature: classification.signature,
      failureMessage: request.lastError ?? request.detail,
      failedAt: request.finishedAt ?? request.updatedAt,
      retryable: classification.retryable,
      retryReason: classification.retryReason,
      alreadyInGraph: false,
      lastRetryAt: null,
      retryCount: request.attemptCount,
    });
  }

  const deduped = new Map<string, PaperIngestionFailedPaper>();
  for (const failure of failures) {
    const classification = classifyPaperIngestionFailure(
      failure.failureMessage ?? failure.failureSignature
    );
    const normalized = {
      ...failure,
      retryable: failure.alreadyInGraph ? false : classification.retryable,
      retryReason: failure.alreadyInGraph
        ? "already_in_graph"
        : failure.retryReason ?? classification.retryReason,
      failureSignature: failure.failureSignature ?? classification.signature,
    };
    const key = keyForFailure(normalized) ?? `failure:${deduped.size}`;
    deduped.set(key, { ...deduped.get(key), ...normalized });
  }
  return [...deduped.values()];
}

export async function materializePaperIngestionRetry(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown> | null;
  intervalSeconds?: number | null;
  maxAttempts?: number | null;
}): Promise<{
  retryManifestPath: string;
  retryReportPath: string;
  retryManifest: PaperIngestionRetryManifest;
  failures: PaperIngestionFailedPaper[];
  retryableFailures: PaperIngestionFailedPaper[];
  nonRetryableFailures: PaperIngestionFailedPaper[];
  commandText: string;
}> {
  const state = normalizePaperIngestionState(params.manifest?.paper_ingestion);
  const failures = collectPaperIngestionFailures({ state });
  const retryableFailures = failures.filter(
    (entry) => entry.retryable && !entry.alreadyInGraph
  );
  const nonRetryableFailures = failures.filter(
    (entry) => !entry.retryable || entry.alreadyInGraph
  );
  const intervalSeconds = Math.max(
    1,
    Math.floor(params.intervalSeconds ?? DEFAULT_RETRY_INTERVAL_SECONDS)
  );
  const maxAttempts = Math.max(
    1,
    Math.floor(params.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS)
  );
  const retryManifestPath = RETRY_MANIFEST_PATH;
  const retryReportPath = RETRY_REPORT_PATH;
  const retryManifest: PaperIngestionRetryManifest = {
    schemaVersion: 1,
    projectId: params.projectId,
    corpus:
      typeof params.manifest?.papernexus_shared_corpus === "string"
        ? params.manifest.papernexus_shared_corpus
        : null,
    retryMode: "sequential",
    intervalSeconds,
    maxAttempts,
    createdAt: nowIso(),
    createdBy: "workflow",
    sourceIndexSnapshot: "researcher/PAPER_SOURCE_INDEX.json",
    graphPresenceSnapshot: "graph/GRAPH_PRESENCE_CHECK.json",
    items: retryableFailures.map((entry) => ({
      paperId: entry.paperId,
      title: entry.title,
      sourceKey: entry.sourceKey,
      inputPath: entry.inputPath,
      failureSignature: entry.failureSignature,
      failureMessage: entry.failureMessage,
      retryCount: entry.retryCount,
    })),
  };
  await writeJsonAtomicEnsured(
    path.join(params.projectRoot, retryManifestPath),
    retryManifest
  );
  await writeTextEnsured(
    path.join(params.projectRoot, retryReportPath),
    [
      "# Failed Paper Retry Report",
      "",
      `Generated: ${retryManifest.createdAt}`,
      `Retry mode: sequential`,
      `Interval seconds: ${intervalSeconds}`,
      `Retryable failures: ${retryableFailures.length}`,
      `Non-retryable or already-in-graph failures: ${nonRetryableFailures.length}`,
      "",
      "## Retryable",
      ...retryableFailures.map(
        (entry) =>
          `- ${entry.paperId ?? entry.title ?? entry.inputPath ?? "unknown"} :: ${entry.retryReason}`
      ),
      "",
      "## Skipped",
      ...nonRetryableFailures.map(
        (entry) =>
          `- ${entry.paperId ?? entry.title ?? entry.inputPath ?? "unknown"} :: ${entry.retryReason}`
      ),
      "",
    ].join("\n")
  );
  return {
    retryManifestPath,
    retryReportPath,
    retryManifest,
    failures,
    retryableFailures,
    nonRetryableFailures,
    commandText: buildPapernexusBatchImportCommandText([
      "--manifest",
      retryManifestPath,
      "submit",
      "--sequential",
      "--interval",
      String(intervalSeconds),
    ]),
  };
}

export async function readProjectManifestForRetry(projectRoot: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8"));
  } catch {
    return {};
  }
}
