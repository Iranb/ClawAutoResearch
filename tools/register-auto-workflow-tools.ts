import type {
  OpenClawPluginCommandDefinition,
  OpenClawPluginCommandResponse,
  PluginCommandContext,
} from "../runtime-api.js";
import {
  createResearchWorkflowCommands,
  type WorkflowCommandApi,
  type WorkflowCommandDependencies,
} from "./workflow-commands";
import {
  asObject,
  getToolContext,
  readString,
  textResponse,
  type PluginRegistrationContext,
  type ToolSpec,
} from "./plugin-registration-shared";

type AutoWorkflowToolName = "auto_research" | "auto_review";
type AutoWorkflowCommandName = "auto-research" | "auto-review";

const AUTO_WORKFLOW_TOOL_CONFIG: Record<
  AutoWorkflowToolName,
  {
    commandName: AutoWorkflowCommandName;
    displayCommand: string;
    description: string;
    defaultConversationId: string;
  }
> = {
  auto_research: {
    commandName: "auto-research",
    displayCommand: "/auto-research",
    description:
      "Start the full automated research pipeline from a clean topic. This is the tool-call alias for /auto-research and reuses the canonical project bootstrap and research_pipeline background dispatch.",
    defaultConversationId: "tool-auto-research",
  },
  auto_review: {
    commandName: "auto-review",
    displayCommand: "/auto-review",
    description:
      "Start the full automated survey pipeline from a clean topic. This is the tool-call alias for /auto-review and reuses the canonical survey project bootstrap and survey_review background dispatch.",
    defaultConversationId: "tool-auto-review",
  },
};

function buildAutoWorkflowToolParameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: {
        type: "string",
        description:
          "Clean project topic used for project naming and workflow bootstrap.",
      },
      context: {
        type: "string",
        description:
          "Optional extra requirements, reference papers, datasets, metrics, or constraints to preserve after the clean topic.",
      },
      request: {
        type: "string",
        description:
          "Optional compatibility alias for context when an agent has a richer full request.",
      },
      projectId: {
        type: "string",
        description:
          "Optional explicit workflow project id. Omit to let the canonical bootstrap derive one from the topic.",
      },
      sessionKey: {
        type: "string",
        description:
          "Optional target workflow session key. Usually supplied by OpenClaw tool context.",
      },
      messageChannel: {
        type: "string",
        description:
          "Optional message channel override such as local, discord, or telegram.",
      },
      conversationId: {
        type: "string",
        description:
          "Optional conversation id used only when the tool context does not include a workflow session.",
      },
      accountId: {
        type: "string",
        description:
          "Optional channel account id used for notification-channel binding.",
      },
      messageThreadId: {
        anyOf: [{ type: "string" }, { type: "number" }],
        description:
          "Optional thread id used for channel binding when supported by the message channel.",
      },
    },
    required: ["topic"],
  };
}

function buildCommandArgs(params: Record<string, unknown>): string | null {
  const topic = readString(params.topic);
  if (!topic) {
    return null;
  }
  const supplemental = readString(params.context) ?? readString(params.request);
  return supplemental && supplemental !== topic
    ? `${JSON.stringify(topic)} ${supplemental}`
    : JSON.stringify(topic);
}

function readThreadId(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return readString(value);
}

function buildDefaultFrom(params: {
  messageChannel: string;
  conversationId: string;
}): string {
  if (params.messageChannel === "discord") {
    return params.conversationId.startsWith("channel:")
      ? `discord:${params.conversationId}`
      : `discord:channel:${params.conversationId}`;
  }
  if (params.messageChannel === "local") {
    return `local:conversation:${params.conversationId}`;
  }
  return params.conversationId;
}

function buildToolCommandContext(params: {
  commandName: AutoWorkflowCommandName;
  displayCommand: string;
  defaultConversationId: string;
  rawContext: Record<string, unknown>;
  toolParams: Record<string, unknown>;
  args: string;
  api: WorkflowCommandApi;
}): PluginCommandContext & Record<string, unknown> {
  const normalizedContext = getToolContext(params.rawContext);
  const deliveryContext = asObject(params.rawContext.deliveryContext);
  const messageChannel =
    readString(params.toolParams.messageChannel) ??
    normalizedContext.messageChannel ??
    readString(params.rawContext.messageChannel) ??
    readString(params.rawContext.channel) ??
    "local";
  const conversationId =
    readString(params.toolParams.conversationId) ??
    readString(params.rawContext.conversationId) ??
    readString(deliveryContext?.conversationId) ??
    params.defaultConversationId;
  const sessionKey =
    readString(params.toolParams.sessionKey) ??
    normalizedContext.sessionKey ??
    readString(params.rawContext.sessionKey) ??
    `agent:researcher:${messageChannel}:${conversationId}`;
  const accountId =
    readString(params.toolParams.accountId) ??
    readString(params.rawContext.accountId) ??
    readString(params.rawContext.agentAccountId) ??
    readString(deliveryContext?.accountId) ??
    "default";
  const messageThreadId =
    readThreadId(params.toolParams.messageThreadId) ??
    readThreadId(params.rawContext.messageThreadId) ??
    readThreadId(params.rawContext.threadId) ??
    readThreadId(deliveryContext?.messageThreadId) ??
    readThreadId(deliveryContext?.threadId);
  const from =
    readString(params.rawContext.from) ??
    readString(deliveryContext?.from) ??
    buildDefaultFrom({ messageChannel, conversationId });

  return {
    channel: messageChannel,
    isAuthorizedSender: true,
    args: params.args,
    commandBody: `${params.displayCommand} ${params.args}`,
    config: params.api.config ?? {},
    from,
    to:
      readString(params.rawContext.to) ??
      readString(deliveryContext?.to) ??
      undefined,
    accountId,
    ...(messageThreadId != null ? { messageThreadId } : {}),
    senderId:
      readString(params.rawContext.requesterSenderId) ??
      readString(params.rawContext.senderId) ??
      undefined,
    requestConversationBinding: async () => ({ status: "unsupported" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
    commandSource: "tool",
    sessionKey,
    commandTargetSessionKey: sessionKey,
    conversationId,
    channelKey:
      readString(params.toolParams.channelKey) ??
      normalizedContext.channelKey ??
      readString(params.rawContext.channelKey) ??
      undefined,
    projectId: readString(params.toolParams.projectId),
    toolName:
      params.commandName === "auto-research" ? "auto_research" : "auto_review",
  };
}

function findCommand(
  commands: OpenClawPluginCommandDefinition[],
  name: AutoWorkflowCommandName
): OpenClawPluginCommandDefinition {
  const command = commands.find((entry) => entry.name === name);
  if (!command) {
    throw new Error(`Missing workflow command handler: ${name}`);
  }
  return command;
}

function commandResponseToToolText(result: OpenClawPluginCommandResponse): string {
  return (
    result.text ??
    JSON.stringify(
      {
        presentation: result.presentation ?? null,
        channelData: result.channelData ?? null,
      },
      null,
      2
    )
  );
}

function createAutoWorkflowTool(params: {
  toolName: AutoWorkflowToolName;
  command: OpenClawPluginCommandDefinition;
  api: WorkflowCommandApi;
}): (rawContext: Record<string, unknown>) => ToolSpec {
  const config = AUTO_WORKFLOW_TOOL_CONFIG[params.toolName];
  return (rawContext) => ({
    name: params.toolName,
    description: config.description,
    parameters: buildAutoWorkflowToolParameters(),
    async execute(_id, toolParams) {
      const args = buildCommandArgs(toolParams);
      if (!args) {
        return textResponse(
          `ERROR: ${config.displayCommand} requires topic, for example: ${config.displayCommand} "gcd confirmation bias mitigation"`
        );
      }
      const commandContext = buildToolCommandContext({
        commandName: config.commandName,
        displayCommand: config.displayCommand,
        defaultConversationId: config.defaultConversationId,
        rawContext,
        toolParams,
        args,
        api: params.api,
      });
      const result = await params.command.handler(commandContext);
      return textResponse(commandResponseToToolText(result));
    },
  });
}

export function registerAutoWorkflowTools(
  plugin: PluginRegistrationContext,
  deps: Partial<WorkflowCommandDependencies> = {}
) {
  const api = plugin.api as unknown as WorkflowCommandApi;
  const commands = createResearchWorkflowCommands(api, deps);

  for (const toolName of ["auto_research", "auto_review"] as const) {
    const config = AUTO_WORKFLOW_TOOL_CONFIG[toolName];
    plugin.api.registerTool(
      createAutoWorkflowTool({
        toolName,
        command: findCommand(commands, config.commandName),
        api,
      }),
      { name: toolName, optional: true }
    );
  }
}
