export type PluginCommandContext = {
  senderId?: string;
  channel: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: string | number;
  requestConversationBinding: (...args: any[]) => Promise<unknown>;
  detachConversationBinding: (...args: any[]) => Promise<unknown>;
  getCurrentConversationBinding: (...args: any[]) => Promise<unknown>;
};

export type OpenClawPluginCommandDefinition = {
  name: string;
  nativeNames?: Partial<Record<string, string>> & { default?: string };
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: PluginCommandContext) => Promise<{ text?: string }> | { text?: string };
};

export type OpenClawPluginServiceContext = {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
};

export type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => Promise<void> | void;
  stop?: (ctx: OpenClawPluginServiceContext) => Promise<void> | void;
};

export type OpenClawPluginApi = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  runtime: any;
  logger: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
  registerTool: (...args: any[]) => void;
  on?: (...args: any[]) => void;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  registerService?: (service: OpenClawPluginService) => void;
};

export type OpenClawPluginEntryDefinition = {
  id: string;
  name: string;
  description: string;
  kind?: string;
  configSchema?: unknown;
  register: (api: OpenClawPluginApi) => void;
};

export function definePluginEntry<TEntry extends OpenClawPluginEntryDefinition>(
  entry: TEntry
): TEntry {
  return entry;
}
