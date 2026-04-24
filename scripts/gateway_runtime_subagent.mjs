#!/usr/bin/env node
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";

function parseJson(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
  } catch {
    return null;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildGatewayRuntimeMessage(runParams = {}) {
  const task = readString(runParams.message) ?? "";
  const projectRoot = readString(runParams.projectRoot);
  const projectId = readString(runParams.projectId);
  const workspaceDir = readString(runParams.workspaceDir);
  const ownerAgent = readString(runParams.ownerAgent);
  const requesterSessionKey = readString(runParams.requesterSessionKey);
  const messageChannel = readString(runParams.messageChannel);
  const extraSystemPrompt = readString(runParams.extraSystemPrompt);
  const contextLines = [
    "Workflow runtime context (authoritative; resolve this before workflow tool calls):",
    projectRoot ? `Project root: ${projectRoot}` : null,
    projectId ? `Project ID: ${projectId}` : null,
    workspaceDir ? `Workspace dir: ${workspaceDir}` : null,
    ownerAgent ? `Owner agent: ${ownerAgent}` : null,
    requesterSessionKey ? `Requester session: ${requesterSessionKey}` : null,
    messageChannel ? `Message channel: ${messageChannel}` : null,
    projectRoot
      ? "Before calling project-bound workflow tools, bind or resolve this exact project if the workflow state is unbound."
      : null,
    projectRoot
      ? `If binding is needed, call research_workflow.bind_channel_project with projectRoot="${projectRoot}"${projectId ? ` and projectId="${projectId}"` : ""}.`
      : null,
    projectRoot
      ? "Do not create or use a sibling/default project directory; all durable artifacts for this run belong under the Project root above."
      : null,
  ].filter(Boolean);
  if (contextLines.length === 1 && !extraSystemPrompt) {
    return task;
  }
  return [
    contextLines.length > 1 ? contextLines.join("\n") : null,
    extraSystemPrompt ? `Continuation instructions:\n${extraSystemPrompt}` : null,
    task ? `Task:\n${task}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function resolveGatewayHarnessConfig(params = {}) {
  const profile = params.profile ?? process.env.OPENCLAW_PROFILE ?? "default";
  const configPath =
    params.configPath ??
    (profile === "dev"
      ? `${process.env.HOME}/.openclaw-dev/openclaw.json`
      : `${process.env.HOME}/.openclaw/openclaw.json`);
  const raw = (await readJson(configPath)) ?? {};
  const gateway = raw.gateway ?? {};
  const auth = gateway.auth ?? {};
  const host = gateway.bind === "loopback" ? "127.0.0.1" : gateway.host ?? "127.0.0.1";
  const port = gateway.port ?? 18789;
  const token = params.token ?? auth.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? null;
  return {
    profile,
    configPath,
    url: params.url ?? `ws://${host}:${port}`,
    token,
    protocolVersion: 3,
  };
}

async function waitForOpen(ws, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for websocket open")), timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true }
    );
    ws.addEventListener(
      "error",
      (event) => {
        clearTimeout(timer);
        reject(event.error ?? new Error("websocket open error"));
      },
      { once: true }
    );
  });
}

async function waitForFrame(ws, predicate, timeoutMs, label) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${label}`));
    }, timeoutMs);
    const onMessage = (event) => {
      const payload = parseJson(event.data ?? event);
      if (!payload) {
        return;
      }
      if (predicate(payload)) {
        cleanup();
        resolve(payload);
      }
    };
    const onClose = (event) => {
      cleanup();
      reject(new Error(`socket closed while waiting for ${label}: ${event.code ?? "unknown"} ${event.reason ?? ""}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
  });
}

function buildSignedDevice(params) {
  const signedAtMs = Date.now();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const publicKeyRaw = Buffer.from(spki).subarray(ED25519_SPKI_PREFIX.length);
  const deviceId = crypto.createHash("sha256").update(publicKeyRaw).digest("hex");
  const scopes = params.scopes ?? ["operator.admin", "operator.write"];
  const payload = [
    "v3",
    deviceId,
    "test",
    "test",
    "operator",
    scopes.join(","),
    String(signedAtMs),
    params.token,
    params.nonce ?? "",
    "test",
    "",
  ].join("|");
  const signature = crypto
    .sign(null, Buffer.from(payload, "utf8"), privateKey)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return {
    scopes,
    signedAtMs,
    device: {
      id: deviceId,
      publicKey: publicKeyRaw
        .toString("base64")
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/g, ""),
      signature,
      signedAt: signedAtMs,
      nonce: params.nonce ?? null,
    },
  };
}

export async function createGatewayHarnessClient(params = {}) {
  const resolved = await resolveGatewayHarnessConfig(params);
  if (!resolved.token) {
    throw new Error(`No gateway token found in ${resolved.configPath} or OPENCLAW_GATEWAY_TOKEN.`);
  }

  const ws = new WebSocket(resolved.url);
  await waitForOpen(ws, params.openTimeoutMs ?? 10_000);

  const challenge = await waitForFrame(
    ws,
    (payload) => payload?.type === "event" && payload?.event === "connect.challenge",
    params.connectTimeoutMs ?? 10_000,
    "connect.challenge"
  );
  const signed = buildSignedDevice({
    token: resolved.token,
    nonce: challenge?.payload?.nonce ?? null,
    scopes: params.scopes,
  });
  const connectId = `connect-${randomUUID()}`;
  ws.send(
    JSON.stringify({
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: resolved.protocolVersion,
        maxProtocol: resolved.protocolVersion,
        client: {
          id: "test",
          displayName: "vitest",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
        caps: [],
        role: "operator",
        scopes: signed.scopes,
        auth: { token: resolved.token },
        device: signed.device,
      },
    })
  );
  await waitForFrame(
    ws,
    (payload) => payload?.type === "res" && payload?.id === connectId && payload?.ok === true,
    params.connectTimeoutMs ?? 10_000,
    "connect response"
  );

  async function request(method, requestParams, options = {}) {
    const id = `${method}-${randomUUID()}`;
    ws.send(
      JSON.stringify({
        type: "req",
        id,
        method,
        params: requestParams ?? {},
      })
    );
    const response = await waitForFrame(
      ws,
      (payload) => payload?.type === "res" && payload?.id === id,
      options.timeoutMs ?? 30_000,
      `${method} response`
    );
    if (response?.ok !== true) {
      throw new Error(
        response?.error?.message ??
          response?.message ??
          `${method} failed`
      );
    }
    return response.payload;
  }

  async function stop() {
    try {
      ws.close(1000, "done");
    } catch {}
  }

  return {
    config: resolved,
    request,
    async chatSend(params) {
      return await request(
        "chat.send",
        {
          sessionKey: params.sessionKey,
          message: params.message,
          idempotencyKey: params.idempotencyKey ?? `chat-send-${randomUUID()}`,
          ...(params.originatingChannel ? { originatingChannel: params.originatingChannel } : {}),
          ...(params.originatingTo ? { originatingTo: params.originatingTo } : {}),
          ...(params.originatingAccountId ? { originatingAccountId: params.originatingAccountId } : {}),
          ...(params.originatingThreadId ? { originatingThreadId: params.originatingThreadId } : {}),
        },
        { timeoutMs: params.timeoutMs ?? 30_000 }
      );
    },
    async agentWait(params) {
      return await request(
        "agent.wait",
        {
          runId: params.runId,
          timeoutMs: params.timeoutMs ?? 120_000,
        },
        {
          timeoutMs: (params.timeoutMs ?? 120_000) + 5_000,
        }
      );
    },
    async chatHistory(params) {
      return await request(
        "chat.history",
        {
          sessionKey: params.sessionKey,
          limit: params.limit ?? 32,
        },
        { timeoutMs: params.timeoutMs ?? 30_000 }
      );
    },
    stop,
  };
}

export async function createGatewayRuntimeSubagent(params = {}) {
  const client = await createGatewayHarnessClient(params);
  const defaultOriginatingChannel = params.originatingChannel ?? "discord";
  const defaultOriginatingTo = params.originatingTo ?? null;
  const defaultOriginatingAccountId = params.originatingAccountId ?? "default";
  return {
    client,
    runtimeSubagent: {
      async run(runParams) {
        const started = await client.chatSend({
          sessionKey: runParams.sessionKey,
          message: buildGatewayRuntimeMessage(runParams),
          idempotencyKey: runParams.idempotencyKey,
          originatingChannel: runParams.originatingChannel ?? defaultOriginatingChannel,
          originatingTo: runParams.originatingTo ?? defaultOriginatingTo,
          originatingAccountId:
            runParams.originatingAccountId ?? defaultOriginatingAccountId,
          timeoutMs: params.chatTimeoutMs ?? 30_000,
        });
        if (started?.status !== "started" || typeof started?.runId !== "string") {
          throw new Error(`chat.send did not start correctly: ${JSON.stringify(started)}`);
        }
        return { runId: started.runId };
      },
      async waitForRun(waitParams) {
        const result = await client.agentWait(waitParams);
        return {
          status: result?.status ?? "error",
          error: result?.error ?? null,
        };
      },
      async getSessionMessages(historyParams) {
        const result = await client.chatHistory(historyParams);
        return { messages: Array.isArray(result?.messages) ? result.messages : [] };
      },
    },
    async stop() {
      await client.stop();
    },
  };
}
