name: workflow-agent-dispatch
args:
  pluginRoot:
    default: ""
  gatewayUrl:
    default: "http://127.0.0.1:18789"
  sessionKey:
    default: ""
  messageChannel:
    default: "discord"
  accountId:
    default: ""
  toAgent:
    default: ""
  subject:
    default: "Workflow task dispatch"
  command:
    default: ""
  extraBody:
    default: ""
  waitTimeoutMs:
    default: "0"
  retryOnTimeout:
    default: "true"
  enableSpawnFallback:
    default: "true"
steps:
  - id: dispatch
    env:
      OPENCLAW_RESEARCH_PLUGIN_ROOT: $args.pluginRoot
      OPENCLAW_GATEWAY_HTTP_URL: $args.gatewayUrl
      OPENCLAW_SESSION_KEY: $args.sessionKey
      OPENCLAW_MESSAGE_CHANNEL: $args.messageChannel
      OPENCLAW_ACCOUNT_ID: $args.accountId
      OPENCLAW_TO_AGENT: $args.toAgent
      OPENCLAW_DISPATCH_SUBJECT: $args.subject
      OPENCLAW_DISPATCH_COMMAND: $args.command
      OPENCLAW_DISPATCH_EXTRA_BODY: $args.extraBody
      OPENCLAW_DISPATCH_WAIT_TIMEOUT_MS: $args.waitTimeoutMs
      OPENCLAW_DISPATCH_RETRY_ON_TIMEOUT: $args.retryOnTimeout
      OPENCLAW_DISPATCH_ENABLE_SPAWN_FALLBACK: $args.enableSpawnFallback
    command: node "${OPENCLAW_RESEARCH_PLUGIN_ROOT}/lobster/scripts/workflow-task-dispatch.mjs"
