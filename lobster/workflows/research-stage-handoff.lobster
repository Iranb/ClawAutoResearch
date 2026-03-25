name: research-stage-handoff
args:
  sessionKey:
    default: ""
  messageChannel:
    default: "discord"
  accountId:
    default: ""
  gatewayUrl:
    default: "http://127.0.0.1:18789"
steps:
  - id: handoff
    env:
      OPENCLAW_SESSION_KEY: $args.sessionKey
      OPENCLAW_MESSAGE_CHANNEL: $args.messageChannel
      OPENCLAW_ACCOUNT_ID: $args.accountId
      OPENCLAW_GATEWAY_HTTP_URL: $args.gatewayUrl
    command: node "${OPENCLAW_RESEARCH_PLUGIN_ROOT}/lobster/scripts/research-stage-handoff.mjs"
