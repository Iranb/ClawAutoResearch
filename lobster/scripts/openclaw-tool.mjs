import process from "node:process";
import { pathToFileURL } from "node:url";

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

function parseJsonLoose(raw, fallback) {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  return JSON.parse(raw);
}

function readBearerToken(flags) {
  return (
    flags.token ||
    process.env.OPENCLAW_GATEWAY_TOKEN ||
    process.env.OPENCLAW_GATEWAY_PASSWORD ||
    null
  );
}

function normalizeGatewayBaseUrl(flags) {
  const base =
    flags["gateway-url"] ||
    process.env.OPENCLAW_GATEWAY_HTTP_URL ||
    "http://127.0.0.1:18789";
  return String(base).replace(/\/+$/, "");
}

export function unwrapToolResult(rawResult) {
  if (!rawResult || typeof rawResult !== "object") {
    return rawResult;
  }
  if ("details" in rawResult && rawResult.details !== undefined) {
    return rawResult.details;
  }
  if ("content" in rawResult && typeof rawResult.content === "string") {
    try {
      return JSON.parse(rawResult.content);
    } catch {
      return rawResult.content;
    }
  }
  return rawResult;
}

export async function invokeOpenClawTool(params) {
  const {
    gatewayUrl,
    tool,
    action,
    args = {},
    sessionKey,
    messageChannel,
    accountId,
    token,
  } = params;
  if (!tool) {
    throw new Error("tool is required");
  }

  const headers = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (messageChannel) {
    headers["x-openclaw-message-channel"] = messageChannel;
  }
  if (accountId) {
    headers["x-openclaw-account-id"] = accountId;
  }

  const body = {
    tool,
    ...(action ? { action } : {}),
    args,
    ...(sessionKey ? { sessionKey } : {}),
  };

  const response = await fetch(`${gatewayUrl}/tools/invoke`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    const text = await response.text();
    throw new Error(`OpenClaw tools invoke returned non-JSON response: ${text}`);
  }

  if (!response.ok || !payload?.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `tools/invoke failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    response: payload,
    result: unwrapToolResult(payload.result),
  };
}

async function main() {
  const flags = parseFlagArgs(process.argv.slice(2));
  const gatewayUrl = normalizeGatewayBaseUrl(flags);
  const token = readBearerToken(flags);
  const args = parseJsonLoose(flags["args-json"], {});

  const invoked = await invokeOpenClawTool({
    gatewayUrl,
    token,
    tool: flags.tool,
    action: flags.action,
    args,
    sessionKey: flags["session-key"],
    messageChannel: flags["message-channel"],
    accountId: flags["account-id"],
  });

  process.stdout.write(`${JSON.stringify(invoked.result, null, 2)}\n`);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
