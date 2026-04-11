import {
  getContactStatePath,
  getWorkflowContactCooldownImpl,
  readContactStore,
  recordWorkflowContactEventImpl,
  saveContactStore,
  type WorkflowContactEventLike,
  type WorkflowContactStoreLike,
} from "../workflow-guard-collaboration";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import { canRoleContact } from "../workflow-guard-policies/role-policy";

export type WorkflowContactEvent = WorkflowContactEventLike;
export type WorkflowContactStore = WorkflowContactStoreLike;

export { canRoleContact, getContactStatePath };

export async function readWorkflowContactStore(
  projectRoot: string
): Promise<WorkflowContactStore> {
  return readContactStore({ projectRoot, readJsonIfExists });
}

export async function writeWorkflowContactStore(params: {
  projectRoot: string;
  store: WorkflowContactStore;
}): Promise<void> {
  await saveContactStore({
    projectRoot: params.projectRoot,
    store: params.store,
    writeJsonEnsured: writeJsonAtomicEnsured,
  });
}

export async function getWorkflowContactCooldown(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  cooldownSeconds: number;
}): Promise<{
  blocked: boolean;
  remainingSeconds: number;
  lastEvent: WorkflowContactEvent | null;
}> {
  return getWorkflowContactCooldownImpl({
    ...params,
    readJsonIfExists,
  });
}

export async function recordWorkflowContactEvent(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
}): Promise<void> {
  await recordWorkflowContactEventImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured: writeJsonAtomicEnsured,
  });
}
