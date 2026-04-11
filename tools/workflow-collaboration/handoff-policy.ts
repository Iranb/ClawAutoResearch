import { maybeQueueAutoIteratorMailboxImpl } from "../workflow-guard-collaboration";
import { canRoleContact, getWorkflowContactCooldown, recordWorkflowContactEvent } from "./contacts";
import { queueWorkflowMailboxMessage } from "./mailbox";

export function resolveWorkflowHandoffPolicy(params: {
  fromRole: string | null;
  toRole: string | null;
  runtimeAvailable?: boolean;
}): {
  canMailboxHandoff: boolean;
  shouldPreferMailbox: boolean;
  shouldPreferRuntimeDispatch: boolean;
} {
  const canMailboxHandoff = canRoleContact(
    params.fromRole as Parameters<typeof canRoleContact>[0],
    params.toRole as Parameters<typeof canRoleContact>[1]
  );
  return {
    canMailboxHandoff,
    shouldPreferMailbox: canMailboxHandoff && params.runtimeAvailable === false,
    shouldPreferRuntimeDispatch: params.runtimeAvailable !== false,
  };
}

export async function maybeQueueAutoIteratorMailbox(params: {
  projectRoot: string;
  fromRole: Parameters<typeof canRoleContact>[0];
  toRole: Parameters<typeof canRoleContact>[1];
  stage: string | null;
  nextAction: string | null;
  missingStageSignals: string[];
  cooldownSeconds: number;
}): Promise<{
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
}> {
  return maybeQueueAutoIteratorMailboxImpl(params, {
    canRoleContact,
    getWorkflowContactCooldown,
    queueWorkflowMailboxMessage,
    recordWorkflowContactEvent,
  });
}
