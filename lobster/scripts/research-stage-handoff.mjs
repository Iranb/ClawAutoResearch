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

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractAgentIdFromSessionKey(sessionKey) {
  const normalized = readString(sessionKey);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^agent:([^:]+):/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildDispatchPlan({ currentAgentId, tickResult }) {
  const ownerAfter = readString(tickResult?.ownerAfter)?.toLowerCase() ?? null;
  const projectId = readString(tickResult?.projectId);
  const stageAfter =
    readString(tickResult?.stageAfter) ??
    readString(tickResult?.stageEffective) ??
    readString(tickResult?.stageBefore);
  const nextAction =
    readString(tickResult?.nextAction) ??
    readString(tickResult?.resumeAction) ??
    "Read the workflow snapshot and continue the assigned stage.";
  const blockingReason = readString(tickResult?.blockingReason);

  if (!ownerAfter) {
    return {
      shouldDispatch: false,
      reason: "no_owner_after",
      toAgent: null,
      subject: null,
      body: null,
    };
  }

  if (ownerAfter === currentAgentId) {
    return {
      shouldDispatch: false,
      reason: "current_agent_is_owner",
      toAgent: ownerAfter,
      subject: null,
      body: null,
    };
  }

  const stageLabel = stageAfter ?? "next-stage";
  const subject = projectId
    ? `Workflow handoff for ${projectId}: ${stageLabel}`
    : `Workflow handoff: ${stageLabel}`;
  const bodyLines = [
    `Project: ${projectId ?? "unknown-project"}`,
    `Target stage: ${stageLabel}`,
    `Assigned owner: ${ownerAfter}`,
    `Next action: ${nextAction}`,
  ];
  if (blockingReason) {
    bodyLines.push(`Blocking reason: ${blockingReason}`);
  }
  bodyLines.push(
    "Read the workflow mailbox and current project state before doing fresh work."
  );

  return {
    shouldDispatch: true,
    reason: "owner_changed",
    toAgent: ownerAfter,
    subject,
    body: bodyLines.join("\n"),
  };
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

  if (!sessionKey) {
    throw new Error(
      "OPENCLAW_SESSION_KEY (or --session-key) is required for lobster handoff."
    );
  }

  const tick = await invokeOpenClawTool({
    gatewayUrl,
    token,
    tool: "research_workflow",
    action: "auto_iterator_tick",
    sessionKey,
    messageChannel,
    accountId,
    args: {
      iterator: {
        mode: "lobster",
        queueMailbox: true,
        dispatchTasks: false,
        broadcastStageChange: true,
      },
    },
  });

  const currentAgentId = extractAgentIdFromSessionKey(sessionKey);
  const dispatchPlan = buildDispatchPlan({
    currentAgentId,
    tickResult: tick.result,
  });

  let dispatchResult = null;
  if (dispatchPlan.shouldDispatch) {
    const waitSeconds = readNumber(
      flags["wait-seconds"] ?? process.env.OPENCLAW_HANDOFF_WAIT_SECONDS,
      0
    );
    dispatchResult = (
      await invokeOpenClawTool({
        gatewayUrl,
        token,
        tool: "research_workflow",
        action: "dispatch_task",
        sessionKey,
        messageChannel,
        accountId,
        args: {
          toAgent: dispatchPlan.toAgent,
          subject: dispatchPlan.subject,
          body: dispatchPlan.body,
          waitSeconds,
          retryOnTimeout: readBool(
            flags["retry-on-timeout"] ?? process.env.OPENCLAW_HANDOFF_RETRY_ON_TIMEOUT,
            true
          ),
          enableSpawnFallback: readBool(
            flags["enable-spawn-fallback"] ??
              process.env.OPENCLAW_HANDOFF_ENABLE_SPAWN_FALLBACK,
            true
          ),
        },
      })
    ).result;
  }

  const summary = {
    ok: true,
    sessionKey,
    currentAgentId,
    tick: tick.result,
    dispatchPlan,
    dispatchResult,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
