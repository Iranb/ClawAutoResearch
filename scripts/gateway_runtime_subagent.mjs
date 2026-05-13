#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function isLocalRegistryTrackingMiss(result) {
  return /not tracked in the local registry/i.test(String(result?.error ?? ""));
}

function parseAgentIdFromSessionKey(sessionKey) {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  return readString(match?.[1])?.toLowerCase() ?? null;
}

function stripSubagentSuffix(sessionKey) {
  const normalized = readString(sessionKey);
  if (!normalized) {
    return null;
  }
  const marker = normalized.indexOf(":subagent:");
  return marker > 0 ? normalized.slice(0, marker) : normalized;
}

export function resolveGatewayOriginatingRoute(runParams = {}, defaults = {}) {
  const explicitChannel =
    readString(runParams.originatingChannel) ?? readString(defaults.originatingChannel);
  const explicitTo =
    readString(runParams.originatingTo) ?? readString(defaults.originatingTo);
  if (explicitChannel && explicitTo) {
    return {
      originatingChannel: explicitChannel,
      originatingTo: explicitTo,
      originatingAccountId:
        readString(runParams.originatingAccountId) ??
        readString(defaults.originatingAccountId) ??
        "default",
    };
  }

  const candidates = [
    stripSubagentSuffix(runParams.requesterSessionKey),
    stripSubagentSuffix(runParams.sessionKey),
  ].filter((value) => Boolean(value));
  for (const candidate of candidates) {
    const match = /^agent:[^:]+:(local|discord):(conversation|channel|user|direct|slash):(.+)$/.exec(
      candidate
    );
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }
    const channel = match[1];
    const rawTargetKind = match[2];
    const targetValue = readString(match[3]);
    if (!targetValue) {
      continue;
    }
    if (channel === "local") {
      const targetKind = rawTargetKind === "channel" ? "conversation" : rawTargetKind;
      if (targetKind === "conversation" || targetKind === "user") {
        return {
          originatingChannel: "local",
          originatingTo: `${targetKind}:${targetValue}`,
          originatingAccountId:
            readString(runParams.originatingAccountId) ??
            readString(defaults.originatingAccountId) ??
            "default",
        };
      }
      continue;
    }
    if (channel === "discord") {
      const targetKind = rawTargetKind === "direct" ? "user" : rawTargetKind;
      if (targetKind === "channel" || targetKind === "user") {
        return {
          originatingChannel: "discord",
          originatingTo: `${targetKind}:${targetValue}`,
          originatingAccountId:
            readString(runParams.originatingAccountId) ??
            readString(defaults.originatingAccountId) ??
            "default",
        };
      }
    }
  }

  return {
    originatingChannel: null,
    originatingTo: null,
    originatingAccountId: null,
  };
}

function resolveOpenClawHome(params = {}) {
  const explicit = readString(params.openclawHome);
  if (explicit) {
    return path.resolve(explicit.replace(/^~(?=$|\/)/, os.homedir()));
  }
  const configPath = readString(params.configPath);
  if (configPath) {
    return path.dirname(path.resolve(configPath.replace(/^~(?=$|\/)/, os.homedir())));
  }
  const profile = params.profile ?? process.env.OPENCLAW_PROFILE ?? "default";
  return path.join(os.homedir(), profile === "dev" ? ".openclaw-dev" : ".openclaw");
}

function resolveAgentSessionsStorePath(params = {}) {
  const sessionKey = readString(params.sessionKey);
  const agentId =
    readString(params.agentId)?.toLowerCase() ??
    (sessionKey ? parseAgentIdFromSessionKey(sessionKey) : null) ??
    "researcher";
  return path.join(resolveOpenClawHome(params), "agents", agentId, "sessions", "sessions.json");
}

function lookupSessionStoreEntry(store, sessionKey) {
  if (!store || typeof store !== "object" || !sessionKey) {
    return null;
  }
  const exact = asRecord(store[sessionKey]);
  if (exact) {
    return { key: sessionKey, entry: exact };
  }
  const normalized = sessionKey.toLowerCase();
  for (const [key, value] of Object.entries(store)) {
    if (key.toLowerCase() === normalized) {
      const entry = asRecord(value);
      if (entry) {
        return { key, entry };
      }
    }
  }
  return null;
}

async function readLastSessionTranscriptError(sessionFile) {
  const filePath = readString(sessionFile);
  if (!filePath) {
    return null;
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.trim().split(/\n/).filter(Boolean).slice(-80);
    for (const line of lines.reverse()) {
      const event = parseJson(line);
      const message = asRecord(event?.message);
      const errorMessage = readString(message?.errorMessage);
      if (errorMessage) {
        return errorMessage;
      }
      const stopReason = readString(message?.stopReason);
      if (stopReason && stopReason.toLowerCase() === "error") {
        return "Agent session stopped with an error.";
      }
    }
  } catch {}
  return null;
}

export async function inspectGatewayAgentSessionFromStore(params = {}) {
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey) {
    return null;
  }
  const storePath = resolveAgentSessionsStorePath(params);
  const store = await readJson(storePath);
  const matched = lookupSessionStoreEntry(store, sessionKey);
  if (!matched) {
    return null;
  }
  const sessionId = readString(matched.entry.sessionId);
  const sessionFile =
    readString(matched.entry.sessionFile) ??
    (sessionId ? path.join(path.dirname(storePath), `${sessionId}.jsonl`) : null);
  const endedAt = readNumber(matched.entry.endedAt);
  const transcriptError = await readLastSessionTranscriptError(sessionFile);
  const storedStatus = readString(matched.entry.status);
  const inferredStatus =
    storedStatus ?? (transcriptError && endedAt != null ? "failed" : null);
  return {
    sessionKey: matched.key,
    sessionId,
    sessionFile,
    status: inferredStatus,
    startedAt: readNumber(matched.entry.startedAt),
    endedAt,
    updatedAt: readNumber(matched.entry.updatedAt),
    abortedLastRun: matched.entry.abortedLastRun === true,
    providerOverride: readString(matched.entry.providerOverride),
    modelOverride: readString(matched.entry.modelOverride),
    liveModelSwitchPending: matched.entry.liveModelSwitchPending === true,
    error: transcriptError,
    lastError: transcriptError,
  };
}

function terminalWaitResultFromSessionInspection(inspection) {
  const status = readString(inspection?.status)?.toLowerCase() ?? null;
  if (status && ["failed", "aborted"].includes(status)) {
    return {
      status: "error",
      error:
        readString(inspection?.lastError) ??
        readString(inspection?.error) ??
        `Gateway agent session is terminal in the local session store (status=${status}).`,
    };
  }
  if (inspection?.abortedLastRun === true) {
    return {
      status: "error",
      error: "Gateway agent session was aborted in the local session store.",
    };
  }
  if (status && ["completed", "done"].includes(status)) {
    return { status: "ok", error: null };
  }
  return null;
}

export function reconcileGatewayWaitResultWithSessionInspection(waitResult, inspection) {
  const terminal = terminalWaitResultFromSessionInspection(inspection);
  if (!terminal) {
    return waitResult;
  }
  if (waitResult?.status === "timeout" || waitResult?.status === "ok") {
    return terminal;
  }
  return waitResult;
}

async function deleteGatewayAgentSessionFromStore(params = {}) {
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey) {
    return;
  }
  const storePath = resolveAgentSessionsStorePath(params);
  const store = await readJson(storePath);
  const matched = lookupSessionStoreEntry(store, sessionKey);
  if (!matched) {
    return;
  }
  const sessionFile = readString(matched.entry.sessionFile);
  delete store[matched.key];
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  if (params.deleteTranscript === true && sessionFile) {
    await fs.rm(sessionFile, { force: true });
  }
}

export function isGatewayTransientAgentWaitFailure(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error?.message ?? error ?? "");
  return /(?:socket closed while waiting for|timeout waiting for) agent\.wait response/i.test(
    message
  );
}

export function isGatewayConnectHandshakeFailure(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error?.message ?? error ?? "");
  return /(?:timeout waiting for|socket closed while waiting for) connect(?:\.challenge| response)?/i.test(
    message
  );
}

export function isGatewayProviderCapacityFailure(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error?.message ?? error?.error ?? error ?? "");
  return /(?:\b429\b|rate[_ -]?limit|quota exceeded|allocated quota|insufficient[_ -]?quota|billing hard limit)/i.test(
    message
  );
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
  const normalizedOwnerAgent = ownerAgent?.toLowerCase() ?? null;
  const projectContextInstruction = projectRoot
    ? normalizedOwnerAgent && normalizedOwnerAgent !== "researcher"
      ? "For non-Researcher workflow agents, treat Project root and Project ID above as resolved context. Inspect research_workflow.get_channel_project_binding if needed; do not create or rebind a channel/project binding."
      : `If a generic session context must be resolved, call research_workflow.bind_channel_project with projectRoot="${projectRoot}"${projectId ? ` and projectId="${projectId}"` : ""}; this is project context resolution, not a transport binding.`
    : null;
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
    projectContextInstruction,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function healthUrlsForGateway(wsUrl) {
  try {
    const target = new URL(wsUrl);
    target.protocol = target.protocol === "wss:" ? "https:" : "http:";
    return ["/health", "/healthz"].map((pathname) => {
      const candidate = new URL(target.toString());
      candidate.pathname = pathname;
      candidate.search = "";
      candidate.hash = "";
      return candidate.toString();
    });
  } catch {
    return [];
  }
}

async function waitForGatewayHealth(wsUrl, timeoutMs) {
  const healthUrls = healthUrlsForGateway(wsUrl);
  if (healthUrls.length === 0 || timeoutMs <= 0) {
    return { ok: false, error: "gateway health probe skipped" };
  }
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    for (const healthUrl of healthUrls) {
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) {
          return { ok: true, url: healthUrl };
        }
        lastError = new Error(`${healthUrl} returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(500);
  }
  return {
    ok: false,
    error: `Timed out waiting for gateway health at ${healthUrls.join(", ")}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")
    }`,
  };
}

async function openGatewayWebSocketWithRetry(resolved, params) {
  const startupTimeoutMs = params.startupTimeoutMs ?? params.gatewayStartupTimeoutMs ?? 15_000;
  const healthTimeoutMs =
    params.gatewayHealthTimeoutMs ??
    Math.min(5_000, Math.max(0, Math.floor(startupTimeoutMs / 3)));
  const healthResult = await waitForGatewayHealth(resolved.url, healthTimeoutMs);
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < startupTimeoutMs) {
    const ws = new WebSocket(resolved.url);
    ws.addEventListener("error", () => {});
    try {
      await waitForOpen(ws, params.openTimeoutMs ?? 10_000);
      return ws;
    } catch (error) {
      lastError = error;
      try {
        ws.close();
      } catch {}
      await sleep(500);
    }
  }
  throw new Error(
    `Timed out opening gateway websocket at ${resolved.url}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")
    }${healthResult?.ok === false && healthResult.error ? `; health probe: ${healthResult.error}` : ""}`
  );
}

async function connectGatewayWebSocket(resolved, params) {
  const ws = await openGatewayWebSocketWithRetry(resolved, params);
  try {
    const connectTimeoutMs = params.connectTimeoutMs ?? 15_000;
    const challenge = await waitForFrame(
      ws,
      (payload) => payload?.type === "event" && payload?.event === "connect.challenge",
      connectTimeoutMs,
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
      connectTimeoutMs,
      "connect response"
    );
    return ws;
  } catch (error) {
    try {
      ws.close();
    } catch {}
    throw error;
  }
}

async function connectGatewayWebSocketWithHandshakeRetry(resolved, params) {
  const startupTimeoutMs = params.startupTimeoutMs ?? params.gatewayStartupTimeoutMs ?? 45_000;
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < startupTimeoutMs) {
    const remainingMs = Math.max(1_000, startupTimeoutMs - (Date.now() - startedAt));
    try {
      return await connectGatewayWebSocket(resolved, {
        ...params,
        startupTimeoutMs: remainingMs,
        openTimeoutMs: Math.min(params.openTimeoutMs ?? 10_000, remainingMs),
        connectTimeoutMs: Math.min(params.connectTimeoutMs ?? 15_000, remainingMs),
      });
    } catch (error) {
      lastError = error;
      if (!isGatewayConnectHandshakeFailure(error)) {
        throw error;
      }
      await sleep(750);
    }
  }
  throw new Error(
    `Timed out completing gateway websocket connect handshake at ${resolved.url}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")
    }`
  );
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

  const ws = await connectGatewayWebSocketWithHandshakeRetry(resolved, params);

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
      try {
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
      } catch (error) {
        if (isGatewayTransientAgentWaitFailure(error)) {
          return {
            status: "timeout",
            error:
              error instanceof Error
                ? error.message
                : String(error ?? "agent.wait gateway connection closed"),
          };
        }
        throw error;
      }
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
  const defaultOriginatingChannel = readString(params.originatingChannel) ?? null;
  const defaultOriginatingTo = params.originatingTo ?? null;
  const defaultOriginatingAccountId = readString(params.originatingAccountId) ?? null;
  const runSessionKeys = new Map();
  const inspectSession = async (inspectParams) =>
    await inspectGatewayAgentSessionFromStore({
      ...params,
      configPath: client.config?.configPath,
      profile: client.config?.profile,
      sessionKey: inspectParams.sessionKey,
    });
  return {
    client,
    runtimeSubagent: {
      async run(runParams) {
        const originatingRoute = resolveGatewayOriginatingRoute(runParams, {
          originatingChannel: defaultOriginatingChannel,
          originatingTo: defaultOriginatingTo,
          originatingAccountId: defaultOriginatingAccountId,
        });
        const started = await client.chatSend({
          sessionKey: runParams.sessionKey,
          message: buildGatewayRuntimeMessage(runParams),
          idempotencyKey: runParams.idempotencyKey,
          ...(originatingRoute.originatingChannel
            ? { originatingChannel: originatingRoute.originatingChannel }
            : {}),
          ...(originatingRoute.originatingTo
            ? { originatingTo: originatingRoute.originatingTo }
            : {}),
          ...(originatingRoute.originatingChannel && originatingRoute.originatingTo
            ? {
                originatingAccountId:
                  originatingRoute.originatingAccountId ?? "default",
              }
            : {}),
          timeoutMs: params.chatTimeoutMs ?? 30_000,
        });
        if (started?.status !== "started" || typeof started?.runId !== "string") {
          throw new Error(`chat.send did not start correctly: ${JSON.stringify(started)}`);
        }
        runSessionKeys.set(started.runId, runParams.sessionKey);
        return { runId: started.runId };
      },
      async waitForRun(waitParams) {
        const result = await client.agentWait(waitParams);
        const sessionKey = runSessionKeys.get(waitParams.runId);
        const inspection = sessionKey
          ? await inspectSession({ sessionKey })
          : null;
        const reconciled = reconcileGatewayWaitResultWithSessionInspection(
          result,
          inspection
        );
        if (
          result?.status === "error" &&
          isLocalRegistryTrackingMiss(result) &&
          reconciled?.status === "error" &&
          reconciled?.error === result.error
        ) {
          return {
            status: "timeout",
            error: result.error ?? null,
          };
        }
        return {
          status: reconciled?.status ?? "error",
          error: reconciled?.error ?? null,
        };
      },
      async getSessionMessages(historyParams) {
        const result = await client.chatHistory(historyParams);
        return { messages: Array.isArray(result?.messages) ? result.messages : [] };
      },
      inspectSession,
      async deleteSession(deleteParams) {
        await deleteGatewayAgentSessionFromStore({
          ...params,
          configPath: client.config?.configPath,
          profile: client.config?.profile,
          sessionKey: deleteParams.sessionKey,
          deleteTranscript: deleteParams.deleteTranscript === true,
        });
      },
    },
    async stop() {
      await client.stop();
    },
  };
}
