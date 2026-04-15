import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { asRecord, pickString } from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowFileAuditResult,
  WorkflowFileAuditRoundState,
  WorkflowHookPointContext,
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

function clampConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      collectStrings(entry)
    );
  }
  return [];
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return null;
}

export function defaultFileAuditReportDir(policy: WorkflowFileAuditHookPolicy): string {
  return policy.reportDir ?? path.join("reviewer", "file-audits", policy.hookId);
}

export async function computeProjectFileFingerprint(params: {
  projectRoot: string;
  filePath: string;
}): Promise<string | null> {
  const resolved = resolveProjectArtifactPath(params.projectRoot, params.filePath);
  if (!resolved) {
    return null;
  }
  try {
    const content = await fs.readFile(resolved);
    return `sha1:${createHash("sha1").update(content).digest("hex")}`;
  } catch {
    return null;
  }
}

export async function materializeFileAuditPacket(params: {
  projectRoot: string;
  projectId: string | null;
  policy: WorkflowFileAuditHookPolicy;
  context: WorkflowHookPointContext;
  roundNumber: number;
}): Promise<{
  packetPath: string;
  packetJsonPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  fileFingerprint: string | null;
}> {
  const reportDir = path.join(
    params.projectRoot,
    defaultFileAuditReportDir(params.policy),
    `round-${params.roundNumber}`
  );
  const packetPath = path.join(reportDir, "AUDIT_PACKET.md");
  const packetJsonPath = path.join(reportDir, "AUDIT_PACKET.json");
  const reportPath = path.join(reportDir, "AUDIT_REPORT.json");
  const reportMarkdownPath = path.join(reportDir, "AUDIT_REPORT.md");
  const resolvedTargetPath = resolveProjectArtifactPath(
    params.projectRoot,
    params.policy.filePath
  );
  const fileFingerprint = await computeProjectFileFingerprint({
    projectRoot: params.projectRoot,
    filePath: params.policy.filePath,
  });
  const targetText = resolvedTargetPath
    ? await readTextIfExists(resolvedTargetPath)
    : null;
  const supportingArtifactSnapshots = await Promise.all(
    params.policy.supportingArtifacts.map(async (relativePath) => {
      const resolved = resolveProjectArtifactPath(params.projectRoot, relativePath);
      const exists = resolved ? await pathExists(resolved) : false;
      const text = exists && resolved ? await readTextIfExists(resolved) : null;
      return {
        path: relativePath,
        exists,
        preview: text ? text.slice(0, 6000) : null,
      };
    })
  );
  const packetJson = {
    hookId: params.policy.hookId,
    hookPoint: params.context.hookPoint,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stage: params.context.stage,
    ownerRole: params.context.ownerRole,
    actorRole: params.context.actorRole,
    targetRole: params.policy.targetRole,
    auditorRole: params.policy.auditorRole,
    filePath: params.policy.filePath,
    fileFingerprint,
    requirementPrompt: params.policy.requirementPrompt,
    supportingArtifacts: supportingArtifactSnapshots,
    materializedArtifacts: params.context.materializedArtifacts,
    emittedHookEvents: params.context.emittedHookEvents,
    targetFileExists: Boolean(targetText != null),
    targetFileText: targetText,
    createdAt: nowIso(),
  };
  const markdown = [
    "# Workflow File Audit Packet",
    "",
    `- hook_id: ${params.policy.hookId}`,
    `- hook_point: ${params.context.hookPoint}`,
    `- stage: ${params.context.stage ?? "unknown"}`,
    `- project_id: ${params.projectId ?? "unknown"}`,
    `- target_role: ${params.policy.targetRole ?? "unknown"}`,
    `- auditor_role: ${params.policy.auditorRole}`,
    `- file_path: ${params.policy.filePath}`,
    `- file_fingerprint: ${fileFingerprint ?? "missing"}`,
    "",
    "## Requirement Prompt",
    params.policy.requirementPrompt,
    "",
    "## Supporting Artifacts",
    ...supportingArtifactSnapshots.map(
      (entry) => `- ${entry.path}: ${entry.exists ? "present" : "missing"}`
    ),
    "",
    "## Target File",
    "```text",
    targetText ?? "<missing target file>",
    "```",
    "",
    "## Packet JSON",
    "```json",
    JSON.stringify(packetJson, null, 2),
    "```",
  ].join("\n");
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(packetPath, `${markdown}\n`, "utf8");
  await writeJsonEnsured(packetJsonPath, packetJson);
  return {
    packetPath: path.relative(params.projectRoot, packetPath),
    packetJsonPath: path.relative(params.projectRoot, packetJsonPath),
    reportPath: path.relative(params.projectRoot, reportPath),
    reportMarkdownPath: path.relative(params.projectRoot, reportMarkdownPath),
    fileFingerprint,
  };
}

export function buildFileAuditPrompt(params: {
  projectRoot: string;
  projectId: string | null;
  policy: WorkflowFileAuditHookPolicy;
  packetPath: string;
  packetJsonPath: string;
}): string {
  return [
    `Workflow file audit request for ${params.policy.auditorRole}.`,
    `Project ID: ${params.projectId ?? "unknown"}`,
    `Project root: ${params.projectRoot}`,
    `Hook ID: ${params.policy.hookId}`,
    `Hook point: ${params.policy.hookPoint}`,
    `Target role: ${params.policy.targetRole ?? "unknown"}`,
    `Target file: ${params.policy.filePath}`,
    `Requirement prompt: ${params.policy.requirementPrompt}`,
    `Read this packet first: ${params.packetPath}`,
    `Structured packet JSON: ${params.packetJsonPath}`,
    "Audit only the target file against the requirement prompt and supporting artifacts in the packet.",
    "Return ONLY valid JSON with this schema:",
    `{
  "verdict": "pass | revise | block",
  "summary": "one concise paragraph",
  "violations": [
    {
      "rule": "short_rule_id",
      "severity": "low | medium | high | critical",
      "location": "section / line / block or null",
      "message": "what is wrong"
    }
  ],
  "requiredFixes": ["specific required changes"],
  "reviewedArtifacts": ["relative/path"],
  "confidence": 0.0
}`,
  ].join("\n");
}

export function parseFileAuditResult(params: {
  rawText: string;
  reviewerRole: string;
  filePath: string;
  fileFingerprint: string | null;
  runId?: string | null;
}): WorkflowFileAuditResult {
  const fallback = {
    verdict: "block" as const,
    summary: "Reviewer did not return valid structured JSON.",
    violations: [
      {
        rule: "invalid_json",
        severity: "high" as const,
        location: null,
        message: "Reviewer response could not be parsed as the required JSON schema.",
      },
    ],
    requiredFixes: [],
    reviewedArtifacts: [params.filePath],
    confidence: null,
    runId: params.runId ?? null,
    rawText: params.rawText,
    reviewerRole: params.reviewerRole,
    filePath: params.filePath,
    fileFingerprint: params.fileFingerprint,
    createdAt: nowIso(),
  };
  try {
    const jsonText = extractJsonObject(params.rawText) ?? params.rawText;
    const record = asRecord(JSON.parse(jsonText));
    if (!record) {
      return fallback;
    }
    const verdict = pickString(record, ["verdict"])?.toLowerCase();
    return {
      verdict:
        verdict === "pass" || verdict === "revise" || verdict === "block"
          ? verdict
          : "block",
      summary: pickString(record, ["summary"]),
      violations: Array.isArray(record.violations)
        ? record.violations
            .map((entry) => asRecord(entry))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
            .map((entry) => ({
              rule: pickString(entry, ["rule"]) ?? "unclassified",
              severity:
                (pickString(entry, ["severity"]) as
                  | "low"
                  | "medium"
                  | "high"
                  | "critical"
                  | null) ?? "high",
              location: pickString(entry, ["location"]),
              message: pickString(entry, ["message"]) ?? "Audit violation.",
            }))
        : [],
      requiredFixes: collectStrings(record.requiredFixes ?? record.required_fixes),
      reviewedArtifacts: collectStrings(
        record.reviewedArtifacts ?? record.reviewed_artifacts
      ),
      confidence: clampConfidence(record.confidence),
      runId: pickString(record, ["runId", "run_id"]) ?? params.runId ?? null,
      rawText: params.rawText,
      reviewerRole: params.reviewerRole,
      filePath: params.filePath,
      fileFingerprint: params.fileFingerprint,
      createdAt: nowIso(),
    };
  } catch {
    return fallback;
  }
}

export async function writeFileAuditReport(params: {
  projectRoot: string;
  round: Pick<
    WorkflowFileAuditRoundState,
    "reportPath" | "reportMarkdownPath" | "packetPath" | "packetJsonPath" | "filePath"
  >;
  hookId: string;
  result: WorkflowFileAuditResult;
}): Promise<void> {
  const reportResolved = resolveProjectArtifactPath(params.projectRoot, params.round.reportPath);
  const markdownResolved = resolveProjectArtifactPath(
    params.projectRoot,
    params.round.reportMarkdownPath
  );
  if (!reportResolved || !markdownResolved) {
    return;
  }
  await writeJsonEnsured(reportResolved, {
    hook_id: params.hookId,
    packet_path: params.round.packetPath,
    packet_json_path: params.round.packetJsonPath,
    file_path: params.round.filePath,
    ...params.result,
  });
  const markdown = [
    "# Workflow File Audit Report",
    "",
    `- hook_id: ${params.hookId}`,
    `- verdict: ${params.result.verdict}`,
    `- reviewer_role: ${params.result.reviewerRole}`,
    `- file_path: ${params.result.filePath}`,
    `- file_fingerprint: ${params.result.fileFingerprint ?? "missing"}`,
    `- confidence: ${params.result.confidence ?? "n/a"}`,
    "",
    "## Summary",
    params.result.summary ?? "No summary provided.",
    "",
    "## Required Fixes",
    ...(params.result.requiredFixes.length > 0
      ? params.result.requiredFixes.map((entry) => `- ${entry}`)
      : ["- none"]),
    "",
    "## Violations",
    ...(params.result.violations.length > 0
      ? params.result.violations.map(
          (entry) =>
            `- [${entry.severity}] ${entry.rule} @ ${entry.location ?? "unknown"}: ${entry.message}`
        )
      : ["- none"]),
    "",
    "## Reviewed Artifacts",
    ...(params.result.reviewedArtifacts.length > 0
      ? params.result.reviewedArtifacts.map((entry) => `- ${entry}`)
      : ["- none"]),
  ].join("\n");
  await fs.mkdir(path.dirname(markdownResolved), { recursive: true });
  await fs.writeFile(markdownResolved, `${markdown}\n`, "utf8");
}

export function createFileAuditRoundState(params: {
  policy: WorkflowFileAuditHookPolicy;
  stage: string | null;
  hookPoint: WorkflowHookPointContext["hookPoint"];
  packetPath: string;
  packetJsonPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  fileFingerprint: string | null;
  sessionKey: string;
  runId: string | null;
}): WorkflowFileAuditRoundState {
  return {
    roundId: randomUUID(),
    status: "pending",
    hookId: params.policy.hookId,
    hookPoint: params.hookPoint,
    stage: params.stage,
    auditorRole: params.policy.auditorRole,
    targetRole: params.policy.targetRole,
    filePath: params.policy.filePath,
    fileFingerprint: params.fileFingerprint,
    packetPath: params.packetPath,
    packetJsonPath: params.packetJsonPath,
    reportPath: params.reportPath,
    reportMarkdownPath: params.reportMarkdownPath,
    runId: params.runId,
    sessionKey: params.sessionKey,
    launchedAt: nowIso(),
    completedAt: null,
    result: null,
    error: null,
  };
}

export async function readPacketFingerprintFromRound(params: {
  projectRoot: string;
  round: WorkflowFileAuditRoundState | null;
}): Promise<string | null> {
  if (!params.round) {
    return null;
  }
  const packetPath = resolveProjectArtifactPath(params.projectRoot, params.round.packetJsonPath);
  if (!packetPath) {
    return null;
  }
  const packet = await readJsonIfExists<Record<string, unknown>>(packetPath);
  return pickString(asRecord(packet) ?? {}, ["fileFingerprint", "file_fingerprint"]);
}
