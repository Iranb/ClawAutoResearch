import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { writeJsonAtomicEnsured, writeTextEnsured } from "../workflow-guard-core/fs";
import {
  buildExecPayloadBudgetDiagnostic,
  isWorkflowCommandTooLong,
  summarizeExecPayloadForDispatch,
  type WorkflowExecBudgetKind,
} from "./exec-budget";

export type WorkflowExecPacket = {
  schemaVersion: 1;
  packetId: string;
  projectId: string | null;
  stage: string | null;
  ownerRole: string | null;
  createdAt: string;
  commandSummary: string;
  commandText: string;
  packetPath: string;
  scriptPath: string;
  sha256: string;
  requiresApproval: boolean;
  approvalSurface: "web_or_terminal" | "none";
  idempotencyKey: string;
  expectedOutputs: string[];
  rollbackHint: string | null;
  budget: ReturnType<typeof buildExecPayloadBudgetDiagnostic>;
};

export type WorkflowExecPacketMaterialization = {
  materialized: boolean;
  packet: WorkflowExecPacket | null;
  commandForDispatch: string;
  extraBodyForDispatch: string | null;
};

const EXEC_PACKET_DIR = ".openclaw-research/exec-packets";

function nowIso(): string {
  return new Date().toISOString();
}

function safePacketId(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `exec-${hash}-${randomUUID().slice(0, 8)}`;
}

function toProjectRelative(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).replace(/\\/g, "/");
}

export function getWorkflowExecPacketDir(projectRoot: string): string {
  return path.join(projectRoot, EXEC_PACKET_DIR);
}

export async function materializeWorkflowExecPacket(params: {
  projectRoot: string;
  projectId?: string | null;
  stage?: string | null;
  ownerRole?: string | null;
  commandText: string;
  budgetKind: WorkflowExecBudgetKind;
  expectedOutputs?: string[];
  rollbackHint?: string | null;
}): Promise<WorkflowExecPacket> {
  const sha256 = createHash("sha256").update(params.commandText).digest("hex");
  const packetId = safePacketId(
    `${params.projectId ?? ""}:${params.stage ?? ""}:${params.ownerRole ?? ""}:${sha256}`
  );
  const packetDir = getWorkflowExecPacketDir(params.projectRoot);
  const packetPath = path.join(packetDir, `${packetId}.json`);
  const scriptPath = path.join(packetDir, `${packetId}.sh`);
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    params.commandText,
    "",
  ].join("\n");
  const packet: WorkflowExecPacket = {
    schemaVersion: 1,
    packetId,
    projectId: params.projectId ?? null,
    stage: params.stage ?? null,
    ownerRole: params.ownerRole ?? null,
    createdAt: nowIso(),
    commandSummary: summarizeExecPayloadForDispatch(params.commandText),
    commandText: params.commandText,
    packetPath: toProjectRelative(params.projectRoot, packetPath),
    scriptPath: toProjectRelative(params.projectRoot, scriptPath),
    sha256,
    requiresApproval: true,
    approvalSurface: "web_or_terminal",
    idempotencyKey: `exec-packet:${sha256}`,
    expectedOutputs: params.expectedOutputs ?? [],
    rollbackHint: params.rollbackHint ?? null,
    budget: buildExecPayloadBudgetDiagnostic({
      value: params.commandText,
      kind: params.budgetKind,
    }),
  };
  await writeTextEnsured(scriptPath, script);
  await writeJsonAtomicEnsured(packetPath, packet);
  return packet;
}

export async function materializeExecPacketIfNeeded(params: {
  projectRoot: string | null;
  projectId?: string | null;
  stage?: string | null;
  ownerRole?: string | null;
  commandText: string | null | undefined;
  extraBody?: string | null;
  budgetKind: WorkflowExecBudgetKind;
}): Promise<WorkflowExecPacketMaterialization> {
  const commandText = params.commandText?.trim() ?? "";
  if (!commandText || !isWorkflowCommandTooLong(commandText, params.budgetKind)) {
    return {
      materialized: false,
      packet: null,
      commandForDispatch: commandText,
      extraBodyForDispatch: params.extraBody ?? null,
    };
  }
  if (!params.projectRoot) {
    const summary = summarizeExecPayloadForDispatch(commandText);
    return {
      materialized: false,
      packet: null,
      commandForDispatch:
        "Command payload exceeded safe dispatch length but no project root was available to materialize an exec packet.",
      extraBodyForDispatch: [
        params.extraBody,
        `Original command summary: ${summary}`,
        "Repair: bind a workflow project, then re-dispatch so OpenClaw can materialize a file-backed exec packet.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  const packet = await materializeWorkflowExecPacket({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    stage: params.stage,
    ownerRole: params.ownerRole,
    commandText,
    budgetKind: params.budgetKind,
  });
  return {
    materialized: true,
    packet,
    commandForDispatch: `Use file-backed exec packet ${packet.packetPath} (sha256 ${packet.sha256.slice(0, 12)}...). Do not paste or reconstruct the full command in chat.`,
    extraBodyForDispatch: [
      params.extraBody,
      "Long EXEC payload was materialized to avoid OpenClaw obfuscation guard.",
      `Exec packet: {PROJ}/${packet.packetPath}`,
      `Script path: {PROJ}/${packet.scriptPath}`,
      `Command summary: ${packet.commandSummary}`,
      "Approval surface: Web UI or terminal UI if execution approval is required.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
