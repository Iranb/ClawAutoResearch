import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";

export type WorkflowArtifactReceipt = {
  schemaVersion: 1;
  receiptId: string;
  taskId: string | null;
  handoffIntentId: string | null;
  producedByRole: string | null;
  producedBySessionKey: string | null;
  stage: string | null;
  summary: string;
  changedFiles: string[];
  artifactPaths: string[];
  evidencePointers: string[];
  verificationCommands: string[];
  verificationResult: "passed" | "failed" | "not_run";
  blockers: string[];
  assumptions: string[];
  nextSuggestedTaskIds: string[];
  createdAt: string;
};

export type WorkflowArtifactReceiptStore = {
  schemaVersion: 1;
  projectRoot: string;
  projectId: string | null;
  updatedAt: string;
  receipts: WorkflowArtifactReceipt[];
};

const RECEIPTS_FILENAME = "workflow-handoff-receipts.json";

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const stringValue = readString(item);
    if (!stringValue || seen.has(stringValue)) {
      continue;
    }
    seen.add(stringValue);
    result.push(stringValue);
  }
  return result;
}

function normalizeVerificationResult(
  value: unknown
): WorkflowArtifactReceipt["verificationResult"] {
  return value === "passed" || value === "failed" || value === "not_run"
    ? value
    : "not_run";
}

function normalizeReceipt(value: unknown): WorkflowArtifactReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const receiptId = readString(record.receiptId) ?? randomUUID();
  const summary = readString(record.summary);
  if (!summary) {
    return null;
  }
  return {
    schemaVersion: 1,
    receiptId,
    taskId: readString(record.taskId),
    handoffIntentId: readString(record.handoffIntentId),
    producedByRole: readString(record.producedByRole),
    producedBySessionKey: readString(record.producedBySessionKey),
    stage: readString(record.stage),
    summary,
    changedFiles: normalizeStringArray(record.changedFiles),
    artifactPaths: normalizeStringArray(record.artifactPaths),
    evidencePointers: normalizeStringArray(record.evidencePointers),
    verificationCommands: normalizeStringArray(record.verificationCommands),
    verificationResult: normalizeVerificationResult(record.verificationResult),
    blockers: normalizeStringArray(record.blockers),
    assumptions: normalizeStringArray(record.assumptions),
    nextSuggestedTaskIds: normalizeStringArray(record.nextSuggestedTaskIds),
    createdAt: readString(record.createdAt) ?? nowIso(),
  };
}

export function getWorkflowArtifactReceiptPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    RECEIPTS_FILENAME
  );
}

function lockPath(projectRoot: string): string {
  return `${getWorkflowArtifactReceiptPath(projectRoot)}.lock`;
}

export async function readWorkflowArtifactReceiptStore(
  projectRoot: string
): Promise<WorkflowArtifactReceiptStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const raw = await readJsonIfExists<Partial<WorkflowArtifactReceiptStore>>(
    getWorkflowArtifactReceiptPath(resolvedProjectRoot)
  );
  return {
    schemaVersion: 1,
    projectRoot: resolvedProjectRoot,
    projectId: readString(raw?.projectId),
    updatedAt: readString(raw?.updatedAt) ?? nowIso(),
    receipts: Array.isArray(raw?.receipts)
      ? raw.receipts
          .map(normalizeReceipt)
          .filter((entry): entry is WorkflowArtifactReceipt => Boolean(entry))
      : [],
  };
}

export async function writeWorkflowArtifactReceiptStore(
  store: WorkflowArtifactReceiptStore
): Promise<void> {
  await writeJsonAtomicEnsured(getWorkflowArtifactReceiptPath(store.projectRoot), {
    ...store,
    schemaVersion: 1,
    projectRoot: path.resolve(store.projectRoot),
    updatedAt: nowIso(),
  });
}

export async function createWorkflowArtifactReceipt(params: {
  projectRoot: string;
  projectId?: string | null;
  receiptId?: string | null;
  taskId?: string | null;
  handoffIntentId?: string | null;
  producedByRole?: string | null;
  producedBySessionKey?: string | null;
  stage?: string | null;
  summary?: string | null;
  completionNote?: string | null;
  changedFiles?: string[];
  artifactPaths?: string[];
  evidencePointers?: string[];
  verificationCommands?: string[];
  verificationResult?: WorkflowArtifactReceipt["verificationResult"];
  blockers?: string[];
  assumptions?: string[];
  nextSuggestedTaskIds?: string[];
}): Promise<{ receipt: WorkflowArtifactReceipt; created: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowArtifactReceiptStore(projectRoot);
      const receiptId = readString(params.receiptId) ?? randomUUID();
      const existing = store.receipts.find((entry) => entry.receiptId === receiptId);
      if (existing) {
        return { receipt: existing, created: false };
      }
      const receipt: WorkflowArtifactReceipt = {
        schemaVersion: 1,
        receiptId,
        taskId: readString(params.taskId),
        handoffIntentId: readString(params.handoffIntentId),
        producedByRole: readString(params.producedByRole),
        producedBySessionKey: readString(params.producedBySessionKey),
        stage: readString(params.stage),
        summary:
          readString(params.summary) ??
          readString(params.completionNote) ??
          "Workflow task completed without a structured artifact receipt.",
        changedFiles: normalizeStringArray(params.changedFiles),
        artifactPaths: normalizeStringArray(params.artifactPaths),
        evidencePointers: normalizeStringArray(params.evidencePointers),
        verificationCommands: normalizeStringArray(params.verificationCommands),
        verificationResult: normalizeVerificationResult(params.verificationResult),
        blockers: normalizeStringArray(params.blockers),
        assumptions: normalizeStringArray(params.assumptions),
        nextSuggestedTaskIds: normalizeStringArray(params.nextSuggestedTaskIds),
        createdAt: nowIso(),
      };
      await writeWorkflowArtifactReceiptStore({
        ...store,
        projectId: readString(params.projectId) ?? store.projectId,
        receipts: [...store.receipts, receipt],
      });
      return { receipt, created: true };
    },
  });
}

export async function findWorkflowArtifactReceiptsForTask(params: {
  projectRoot: string;
  taskId: string;
}): Promise<WorkflowArtifactReceipt[]> {
  const store = await readWorkflowArtifactReceiptStore(params.projectRoot);
  return store.receipts.filter((entry) => entry.taskId === params.taskId);
}
