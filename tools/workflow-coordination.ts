import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

export type KeyedAsyncQueueHooks = {
  onEnqueue?: () => void;
  onSettle?: () => void;
};

export function enqueueKeyedTask<T>(params: {
  tails: Map<string, Promise<void>>;
  key: string;
  task: () => Promise<T>;
  hooks?: KeyedAsyncQueueHooks;
}): Promise<T> {
  params.hooks?.onEnqueue?.();
  const previous = params.tails.get(params.key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(params.task)
    .finally(() => {
      params.hooks?.onSettle?.();
    });
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  params.tails.set(params.key, tail);
  void tail.finally(() => {
    if (params.tails.get(params.key) === tail) {
      params.tails.delete(params.key);
    }
  });
  return current;
}

export class KeyedAsyncQueue {
  private readonly tails = new Map<string, Promise<void>>();

  getTailMapForTesting(): Map<string, Promise<void>> {
    return this.tails;
  }

  enqueue<T>(key: string, task: () => Promise<T>, hooks?: KeyedAsyncQueueHooks): Promise<T> {
    return enqueueKeyedTask({
      tails: this.tails,
      key,
      task,
      ...(hooks ? { hooks } : {}),
    });
  }
}

export type WorkflowQueueContext = {
  projectRoot?: string | null;
  workspaceDir?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  messageChannel?: string | null;
  channelKey?: string | null;
};

type WorkflowQueueLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
};

const WORKFLOW_COORDINATION_QUEUE = new KeyedAsyncQueue();
const ACTIVE_WORKFLOW_QUEUE_KEYS = new AsyncLocalStorage<Set<string>>();

function normalizeText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveWorkflowProjectQueueKey(projectRoot: string): string {
  return `workflow:project:${path.resolve(projectRoot)}`;
}

export function resolveWorkflowQueueKey(params: WorkflowQueueContext): string {
  const projectRoot = normalizeText(params.projectRoot);
  if (projectRoot) {
    return resolveWorkflowProjectQueueKey(projectRoot);
  }

  const parts: string[] = [];
  const workspaceDir = normalizeText(params.workspaceDir);
  const sessionKey = normalizeText(params.sessionKey);
  const sessionId = normalizeText(params.sessionId);
  const messageChannel = normalizeText(params.messageChannel);
  const channelKey = normalizeText(params.channelKey);

  if (workspaceDir) {
    parts.push(`workspace=${path.resolve(workspaceDir)}`);
  }
  if (messageChannel) {
    parts.push(`channel=${messageChannel.toLowerCase()}`);
  }
  if (channelKey) {
    parts.push(`channel_key=${channelKey.toLowerCase()}`);
  }
  if (sessionKey) {
    parts.push(`session_key=${sessionKey}`);
  }
  if (sessionId) {
    parts.push(`session_id=${sessionId}`);
  }

  return parts.length > 0
    ? `workflow:binding:${parts.join("|")}`
    : "workflow:binding:global";
}

export function buildWorkflowQueueContext(params: WorkflowQueueContext): WorkflowQueueContext {
  return {
    projectRoot: normalizeText(params.projectRoot),
    workspaceDir: normalizeText(params.workspaceDir),
    sessionKey: normalizeText(params.sessionKey),
    sessionId: normalizeText(params.sessionId),
    messageChannel: normalizeText(params.messageChannel),
    channelKey: normalizeText(params.channelKey),
  };
}

export async function enqueueWorkflowTask<T>(params: {
  key?: string | null;
  queueContext?: WorkflowQueueContext;
  task: () => Promise<T>;
  label?: string;
  logger?: WorkflowQueueLogger;
}): Promise<T> {
  const key =
    normalizeText(params.key) ??
    resolveWorkflowQueueKey(params.queueContext ?? {});
  const activeKeys = ACTIVE_WORKFLOW_QUEUE_KEYS.getStore();
  if (activeKeys?.has(key)) {
    return params.task();
  }

  params.logger?.debug?.("Queueing workflow task.", {
    key,
    label: params.label,
  });

  return WORKFLOW_COORDINATION_QUEUE.enqueue(
    key,
    () => {
      const nextActiveKeys = new Set(activeKeys ?? []);
      nextActiveKeys.add(key);
      return ACTIVE_WORKFLOW_QUEUE_KEYS.run(nextActiveKeys, params.task);
    },
    {
      onSettle: () => {
        params.logger?.debug?.("Workflow task settled.", {
          key,
          label: params.label,
        });
      },
    }
  );
}
