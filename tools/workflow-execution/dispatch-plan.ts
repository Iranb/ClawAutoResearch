import type { DispatchableWorkflowRole } from "../agent-task-dispatch";
import type { WorkflowRuntimeQueueDispatchPayload } from "./runtime-store";

function toDispatchableWorkflowRole(value: string): DispatchableWorkflowRole {
  switch (value) {
    case "planner":
    case "orchestrator":
    case "coder":
    case "analyzer":
    case "academic_writer":
    case "reviewer":
    case "cross-reviewer":
    case "researcher":
      return value;
    default:
      return "researcher";
  }
}

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
    toRole: toDispatchableWorkflowRole(payload.toRole),
    summary: payload.summary,
    command: payload.command,
    stage: payload.stage,
    useWorkflowHandoff: payload.useWorkflowHandoff,
    autoModeActive: payload.autoModeActive,
  };
}
