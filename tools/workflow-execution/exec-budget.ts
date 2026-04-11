export const MAX_CHAT_EXEC_COMMAND_CHARS = 1200;
export const MAX_DISPATCH_COMMAND_CHARS = 1200;
export const MAX_BACKGROUND_COMMAND_CHARS = 1600;
export const MAX_INLINE_SYSTEM_PROMPT_CHARS = 4000;

export type WorkflowExecBudgetKind =
  | "chat_exec"
  | "dispatch_command"
  | "background_command"
  | "inline_system_prompt";

export type WorkflowExecBudgetDiagnostic = {
  tooLong: boolean;
  kind: WorkflowExecBudgetKind;
  length: number;
  limit: number;
  reason: string | null;
};

function limitForKind(kind: WorkflowExecBudgetKind): number {
  switch (kind) {
    case "chat_exec":
      return MAX_CHAT_EXEC_COMMAND_CHARS;
    case "dispatch_command":
      return MAX_DISPATCH_COMMAND_CHARS;
    case "background_command":
      return MAX_BACKGROUND_COMMAND_CHARS;
    case "inline_system_prompt":
      return MAX_INLINE_SYSTEM_PROMPT_CHARS;
  }
}

export function buildExecPayloadBudgetDiagnostic(params: {
  value: string | null | undefined;
  kind: WorkflowExecBudgetKind;
}): WorkflowExecBudgetDiagnostic {
  const value = params.value ?? "";
  const limit = limitForKind(params.kind);
  const length = value.length;
  const tooLong = length > limit;
  return {
    tooLong,
    kind: params.kind,
    length,
    limit,
    reason: tooLong
      ? `Command payload length ${length} exceeds ${params.kind} budget ${limit}.`
      : null,
  };
}

export function isWorkflowCommandTooLong(
  commandText: string | null | undefined,
  kind: WorkflowExecBudgetKind = "dispatch_command"
): boolean {
  return buildExecPayloadBudgetDiagnostic({ value: commandText, kind }).tooLong;
}

export function summarizeExecPayloadForDispatch(commandText: string | null | undefined): string {
  const normalized = String(commandText ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No command payload.";
  }
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

export function isExecApprovalRequiredError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return /Obfuscated command detected/i.test(message) ||
    /Command too long/i.test(message) ||
    /exec approvals are not enabled/i.test(message) ||
    /Exec approval is required/i.test(message);
}
