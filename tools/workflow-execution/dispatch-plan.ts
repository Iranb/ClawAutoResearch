import type { DispatchableWorkflowRole } from "../agent-task-dispatch";
import type { WorkflowRuntimeQueueDispatchPayload } from "./runtime-store";

export function buildWorkflowDispatchPlan(
  payload: WorkflowRuntimeQueueDispatchPayload
): {
  toRole: DispatchableWorkflowRole;
  summary: string;
  command: string | null;
  stage: string | null;
  useWorkflowHandoff: boolean;
  autoModeActive: boolean;
} {
  return {
    toRole: payload.toRole,
    summary: payload.summary,
    command: payload.command,
    stage: payload.stage,
    useWorkflowHandoff: payload.useWorkflowHandoff,
    autoModeActive: payload.autoModeActive,
  };
}
