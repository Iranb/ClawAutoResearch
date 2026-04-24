export function buildWorkflowTransportContext(params = {}) {
  const transport = params.transport === "discord" ? "discord" : "local";
  const lane = params.lane === "survey" ? "survey" : "experiment";
  const accountId = params.accountId ?? "default";
  const userId = params.userId ?? "owner";
  const defaultConversationId =
    params.conversationId ??
    (lane === "survey"
      ? transport === "discord"
        ? "gcd-survey-lab"
        : "gcd-survey-local"
      : transport === "discord"
        ? "gcd-research-lab"
        : "gcd-research-local");

  if (transport === "discord") {
    const channelId = defaultConversationId;
    const sessionKeyFor = (role) => `agent:${role}:discord:channel:${channelId}`;
    return {
      transport,
      lane,
      accountId,
      conversationId: channelId,
      channel: "discord",
      from: `discord:channel:${channelId}`,
      to: `slash:${userId}`,
      originatingChannel: "discord",
      originatingTo: `channel:${channelId}`,
      requesterChannel: "discord",
      channelKey: `binding:discord:${accountId}:channel:${channelId}`,
      bootstrapSessionKey: `agent:researcher:discord:slash:${userId}`,
      commandTargetSessionKey: sessionKeyFor("researcher"),
      sessionKeyFor,
      commandContextExtras() {
        return {
          sessionKey: `agent:researcher:discord:slash:${userId}`,
          commandSource: "native",
          commandAuthorized: true,
          commandTargetSessionKey: sessionKeyFor("researcher"),
          originatingChannel: "discord",
          originatingTo: `channel:${channelId}`,
          channelKey: `binding:discord:${accountId}:channel:${channelId}`,
        };
      },
    };
  }

  const conversationId = defaultConversationId;
  const sessionKeyFor = (role) => `agent:${role}:local:conversation:${conversationId}`;
  return {
    transport,
    lane,
    accountId,
    conversationId,
    channel: "local",
    from: `local:conversation:${conversationId}`,
    to: `local:conversation:${conversationId}`,
    originatingChannel: "local",
    originatingTo: `conversation:${conversationId}`,
    requesterChannel: "local",
    channelKey: `binding:local:${accountId}:${conversationId}`,
    bootstrapSessionKey: sessionKeyFor("researcher"),
    commandTargetSessionKey: sessionKeyFor("researcher"),
    sessionKeyFor,
    commandContextExtras() {
      return {
        sessionKey: sessionKeyFor("researcher"),
        conversationId,
        originatingChannel: "local",
        originatingTo: `conversation:${conversationId}`,
        channelKey: `binding:local:${accountId}:${conversationId}`,
      };
    },
  };
}
