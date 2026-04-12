import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
  type WorkflowTaskDispatchResult,
} from "../agent-task-dispatch";
import {
  DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
  handoffWorkflowTaskToAgent,
  shouldUseLobsterForWorkflowHandoff,
  type WorkflowHandoffDispatchResult,
  type WorkflowLobsterHandoffConfig,
} from "../lobster-handoff";

export type WorkflowDeliveryAdapterParams = Parameters<
  typeof handoffWorkflowTaskToAgent
>[0];

export type WorkflowDeliveryAdapterDecision = {
  adapter: "native" | "lobster";
  shouldUseLobster: boolean;
};

export function resolveWorkflowDeliveryAdapter(params: {
  toRole: DispatchableWorkflowRole;
  workflowPolicy?: { lobsterHandoff?: WorkflowLobsterHandoffConfig | null } | null;
  autoModeActive?: boolean;
  requesterSessionKey?: string | null;
}): WorkflowDeliveryAdapterDecision {
  const shouldUseLobster = shouldUseLobsterForWorkflowHandoff({
    config:
      params.workflowPolicy?.lobsterHandoff ??
      DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
    autoModeActive: params.autoModeActive !== false,
  });
  return {
    adapter: shouldUseLobster ? "lobster" : "native",
    shouldUseLobster,
  };
}

export async function deliverWorkflowTaskToAgent(
  params: WorkflowDeliveryAdapterParams
): Promise<WorkflowHandoffDispatchResult> {
  return handoffWorkflowTaskToAgent(params);
}

export { handoffWorkflowTaskToAgent };

export async function dispatchWorkflowTaskNatively(
  params: Parameters<typeof dispatchWorkflowTaskToAgent>[0]
): Promise<WorkflowTaskDispatchResult> {
  return dispatchWorkflowTaskToAgent(params);
}
