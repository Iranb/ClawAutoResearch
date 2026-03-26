import process from "node:process";
import { pathToFileURL } from "node:url";

import { invokeOpenClawTool } from "./openclaw-tool.mjs";

function parseFlagArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function run() {
  const flags = parseFlagArgs(process.argv.slice(2));
  const gatewayUrl =
    readString(flags["gateway-url"]) ??
    readString(process.env.OPENCLAW_GATEWAY_HTTP_URL) ??
    "http://127.0.0.1:18789";
  const token =
    readString(flags.token) ??
    readString(process.env.OPENCLAW_GATEWAY_TOKEN) ??
    readString(process.env.OPENCLAW_GATEWAY_PASSWORD);
  const sessionKey =
    readString(flags["session-key"]) ??
    readString(process.env.OPENCLAW_SESSION_KEY);
  const messageChannel =
    readString(flags["message-channel"]) ??
    readString(process.env.OPENCLAW_MESSAGE_CHANNEL) ??
    "discord";
  const accountId =
    readString(flags["account-id"]) ??
    readString(process.env.OPENCLAW_ACCOUNT_ID);
  const toAgent =
    readString(flags["to-agent"]) ??
    readString(process.env.OPENCLAW_TO_AGENT);
  const subject =
    readString(flags.subject) ??
    readString(process.env.OPENCLAW_DISPATCH_SUBJECT) ??
    "Workflow task dispatch";
  const command =
    readString(flags.command) ??
    readString(process.env.OPENCLAW_DISPATCH_COMMAND);
  const extraBody =
    readString(flags["extra-body"]) ??
    readString(process.env.OPENCLAW_DISPATCH_EXTRA_BODY);

  if (!sessionKey) {
    throw new Error(
      "OPENCLAW_SESSION_KEY (or --session-key) is required for workflow task dispatch."
    );
  }
  if (!toAgent) {
    throw new Error("OPENCLAW_TO_AGENT (or --to-agent) is required for workflow task dispatch.");
  }

  const dispatch = await invokeOpenClawTool({
    gatewayUrl,
    token,
    tool: "research_workflow",
    action: "dispatch_task",
    sessionKey,
    messageChannel,
    accountId,
    args: {
      toAgent,
      subject,
      ...(command ? { command } : {}),
      ...(extraBody ? { extraBody } : {}),
      waitSeconds:
        Math.max(
          0,
          readNumber(
            flags["wait-seconds"] ?? process.env.OPENCLAW_DISPATCH_WAIT_TIMEOUT_MS,
            0
          )
        ) / 1000,
      retryOnTimeout: readBool(
        flags["retry-on-timeout"] ?? process.env.OPENCLAW_DISPATCH_RETRY_ON_TIMEOUT,
        true
      ),
      enableSpawnFallback: readBool(
        flags["enable-spawn-fallback"] ??
          process.env.OPENCLAW_DISPATCH_ENABLE_SPAWN_FALLBACK,
        true
      ),
    },
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "workflow_task_dispatch",
        dispatchResult: dispatch.result,
      },
      null,
      2
    )}\n`
  );
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
