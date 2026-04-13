import {
  findRetriableWorkflowHandoffIntents,
} from "./handoff-store";
import type { WorkflowHandoffIntent } from "./handoff-types";
import {
  deliverWorkflowHandoffIntent,
  type WorkflowHandoffDeliveryRuntime,
} from "./handoff-delivery";
import type { ChannelProjectBindingPolicy } from "../channel-project-bindings";

export type WorkflowHandoffSweepResult = {
  attemptedIntentIds: string[];
  deliveredIntentIds: string[];
  stalledIntentIds: string[];
  terminalIntentIds: string[];
  intents: WorkflowHandoffIntent[];
};

export async function sweepPendingHandoffIntents(params: {
  projectRoot: string;
  runtime?: WorkflowHandoffDeliveryRuntime;
  lobsterMode?: "disabled" | "dry_run" | "enabled";
  bindingPolicy?: ChannelProjectBindingPolicy;
}): Promise<WorkflowHandoffSweepResult> {
  const candidates = await findRetriableWorkflowHandoffIntents({
    projectRoot: params.projectRoot,
  });
  const result: WorkflowHandoffSweepResult = {
    attemptedIntentIds: [],
    deliveredIntentIds: [],
    stalledIntentIds: [],
    terminalIntentIds: [],
    intents: [],
  };
  for (const intent of candidates) {
    result.attemptedIntentIds.push(intent.intentId);
    const delivery = await deliverWorkflowHandoffIntent({
      intent,
      runtime: params.runtime,
      lobsterMode: params.lobsterMode,
      bindingPolicy: params.bindingPolicy,
    });
    result.intents.push(delivery.intent);
    if (delivery.delivered) {
      result.deliveredIntentIds.push(delivery.intent.intentId);
    } else if (delivery.terminal) {
      result.terminalIntentIds.push(delivery.intent.intentId);
    } else {
      result.stalledIntentIds.push(delivery.intent.intentId);
    }
  }
  return result;
}
