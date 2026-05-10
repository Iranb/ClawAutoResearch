import fs from "node:fs/promises";
import path from "node:path";

export type WorkflowPaperArtifactTerminalResult = {
  terminal: boolean;
  reason: "live_paper_artifact_ready" | null;
  details: {
    stage: string | null;
    owner: string | null;
    lane: string;
    pdfExists: boolean;
    texExists: boolean;
    writePackageStatus: string | null;
    paperQcStatus: string | null;
    experimentStatus: string | null;
    writeReady: boolean;
    paperQcReady: boolean;
    experimentReady: boolean;
    stageAllowsTerminal: boolean;
    blockingReason: string | null;
  };
};

const READY_STATUSES = new Set([
  "ready",
  "approved",
  "assembled",
  "completed",
  "complete",
  "pass",
  "passed",
  "verified",
  "succeeded",
  "success",
]);

const EXPERIMENT_READY_STATUSES = new Set([
  ...READY_STATUSES,
  "ready_for_analysis",
]);

const PAPER_ARTIFACT_TERMINAL_STAGES = new Set([
  "write",
  "review",
  "submit",
  "done",
]);

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedStatus(value: unknown): string | null {
  return readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function manifestStateStatus(
  manifest: Record<string, unknown>,
  snakeName: string,
  camelName: string
): string | null {
  return (
    readString(readRecord(manifest[snakeName])?.status) ??
    readString(readRecord(manifest[camelName])?.status)
  );
}

function statusIsOneOf(value: unknown, allowed: Set<string>): boolean {
  const normalized = normalizedStatus(value);
  return Boolean(normalized && allowed.has(normalized));
}

function stageAllowsPaperArtifactTerminal(value: unknown): boolean {
  const stage = normalizedStatus(value);
  return Boolean(stage && PAPER_ARTIFACT_TERMINAL_STAGES.has(stage));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectWorkflowPaperArtifactTerminal(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  lane?: string | null;
}): Promise<WorkflowPaperArtifactTerminalResult> {
  const manifest = readRecord(params.manifest) ?? {};
  const lane = readString(params.lane) ?? "experiment";
  const stage = readString(manifest.current_stage) ?? null;
  const paperPdfPath = path.join(params.projectRoot, "academic_writer", "paper", "main.pdf");
  const paperTexPath = path.join(params.projectRoot, "academic_writer", "paper", "main.tex");
  const [pdfExists, texExists] = await Promise.all([
    pathExists(paperPdfPath),
    pathExists(paperTexPath),
  ]);
  const writePackageStatus = manifestStateStatus(manifest, "write_package", "writePackage");
  const paperQcStatus = manifestStateStatus(manifest, "paper_qc", "paperQc");
  const experimentStatus = manifestStateStatus(
    manifest,
    "experiment_search",
    "experimentSearch"
  );
  const writeReady = statusIsOneOf(writePackageStatus, READY_STATUSES);
  const paperQcReady = statusIsOneOf(paperQcStatus, READY_STATUSES);
  const experimentReady =
    lane !== "experiment" ||
    statusIsOneOf(experimentStatus, EXPERIMENT_READY_STATUSES);
  const stageAllowsTerminal = stageAllowsPaperArtifactTerminal(stage);
  const blockingReason =
    readString(manifest.blocking_reason) ??
    readString(readRecord(manifest.orchestration_state)?.blocking_reason) ??
    null;
  const terminal =
    stageAllowsTerminal &&
    pdfExists &&
    texExists &&
    writeReady &&
    paperQcReady &&
    experimentReady &&
    !blockingReason;

  return {
    terminal,
    reason: terminal ? "live_paper_artifact_ready" : null,
    details: {
      stage,
      owner: readString(manifest.owner_agent) ?? null,
      lane,
      pdfExists,
      texExists,
      writePackageStatus: writePackageStatus ?? null,
      paperQcStatus: paperQcStatus ?? null,
      experimentStatus: experimentStatus ?? null,
      writeReady,
      paperQcReady,
      experimentReady,
      stageAllowsTerminal,
      blockingReason,
    },
  };
}
