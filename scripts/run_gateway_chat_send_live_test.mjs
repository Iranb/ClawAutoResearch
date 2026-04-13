#!/usr/bin/env node
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function resolveGatewayConfig() {
  const profile = argValue("--profile", "default");
  const configPath =
    profile === "dev"
      ? "/Users/iranb/.openclaw-dev/openclaw.json"
      : "/Users/iranb/.openclaw/openclaw.json";
  const raw = (await readJson(configPath)) ?? {};
  const gateway = raw.gateway ?? {};
  const auth = gateway.auth ?? {};
  const host = gateway.bind === "loopback" ? "127.0.0.1" : gateway.host ?? "127.0.0.1";
  const port = gateway.port ?? 18789;
  const token = argValue("--token") ?? auth.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? null;
  return {
    configPath,
    url: argValue("--url") ?? `ws://${host}:${port}`,
    token,
  };
}

function parseJson(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
  } catch {
    return null;
  }
}

async function waitFor(ws, predicate, timeoutMs, label) {
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

async function main() {
  const message = argValue("--message");
  if (!message) {
    console.error(
      'Usage: node scripts/run_gateway_chat_send_live_test.mjs --message "/auto-research \\"topic\\"" [--session-key agent:researcher:main] [--profile default|dev]'
    );
    process.exit(2);
  }
  const { configPath, url, token } = await resolveGatewayConfig();
  if (!token) {
    throw new Error(`No gateway token found in ${configPath} or OPENCLAW_GATEWAY_TOKEN.`);
  }
  const sessionKey = argValue("--session-key", "agent:researcher:main");
  const originatingChannel = argValue("--originating-channel", null);
  const originatingTo = argValue("--originating-to", null);
  const originatingAccountId = argValue("--originating-account-id", null);
  const originatingThreadId = argValue("--originating-thread-id", null);
  const timeoutMs = Number(argValue("--timeout-ms", "120000"));
  const protocolVersion = 3;
  const connectId = `connect-${randomUUID()}`;
  const requestId = `chat-send-${randomUUID()}`;
  const runId = `chat-send-run-${randomUUID()}`;

  const ws = new WebSocket(url);
  const capturedEvents = [];
  let connectRes = null;
  let ack = null;
  ws.addEventListener("message", (event) => {
    const parsed = parseJson(event.data ?? event);
    if (parsed) {
      capturedEvents.push(parsed);
    }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for websocket open")), 10000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(err.error ?? err);
    }, { once: true });
  });

  const challenge = await waitFor(
    ws,
    (payload) => payload?.type === "event" && payload?.event === "connect.challenge",
    10000,
    "connect.challenge"
  );

  const signedAtMs = Date.now();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const publicKeyRaw = Buffer.from(spki).subarray(ED25519_SPKI_PREFIX.length);
  const deviceId = crypto.createHash("sha256").update(publicKeyRaw).digest("hex");
  const nonce = challenge?.payload?.nonce ?? null;
  const scopes = ["operator.admin", "operator.write"];
  const payload = [
    "v3",
    deviceId,
    "test",
    "test",
    "operator",
    scopes.join(","),
    String(signedAtMs),
    token,
    nonce,
    "test",
    "",
  ].join("|");
  const signature = crypto
    .sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

  ws.send(
    JSON.stringify({
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: protocolVersion,
        maxProtocol: protocolVersion,
        client: {
          id: "test",
          displayName: "vitest",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
        caps: [],
        role: "operator",
        scopes,
        auth: { token },
        device: {
          id: deviceId,
          publicKey: publicKeyRaw
            .toString("base64")
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/g, ""),
          signature,
          signedAt: signedAtMs,
          nonce,
        },
      },
    })
  );

  connectRes = await waitFor(
    ws,
    (payload) => payload?.type === "res" && payload?.id === connectId,
    10000,
    "connect response"
  );

  ws.send(
    JSON.stringify({
      type: "req",
      id: requestId,
      method: "chat.send",
      params: {
        sessionKey,
        message,
        idempotencyKey: runId,
        ...(originatingChannel ? { originatingChannel } : {}),
        ...(originatingTo ? { originatingTo } : {}),
        ...(originatingAccountId ? { originatingAccountId } : {}),
        ...(originatingThreadId ? { originatingThreadId } : {}),
      },
    })
  );

  ack = await waitFor(
    ws,
    (payload) => payload?.type === "res" && payload?.id === requestId,
    30000,
    "chat.send response"
  );
  try {
    const finalEvent = await waitFor(
      ws,
      (payload) =>
        payload?.type === "event" &&
        payload?.event === "chat" &&
        payload?.payload?.runId === runId &&
        payload?.payload?.state === "final",
      timeoutMs,
      "chat final event"
    );

    console.log(
      JSON.stringify(
        {
          configPath,
          url,
          sessionKey,
          originatingChannel,
          originatingTo,
          originatingAccountId,
          message,
          challengeNonce: challenge?.payload?.nonce ?? null,
          connectRes: {
            ok: connectRes?.ok ?? null,
            type: connectRes?.payload?.type ?? null,
            protocol: connectRes?.payload?.protocol ?? null,
            connId: connectRes?.payload?.server?.connId ?? null,
          },
          ack,
          finalEvent,
          totalEventsSeen: capturedEvents.length,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          configPath,
          url,
          sessionKey,
          originatingChannel,
          originatingTo,
          originatingAccountId,
          message,
          challengeNonce: challenge?.payload?.nonce ?? null,
          connectRes: {
            ok: connectRes?.ok ?? null,
            type: connectRes?.payload?.type ?? null,
            protocol: connectRes?.payload?.protocol ?? null,
            connId: connectRes?.payload?.server?.connId ?? null,
          },
          ack,
          error: error instanceof Error ? error.message : String(error),
          recentEvents: capturedEvents.slice(-20),
          totalEventsSeen: capturedEvents.length,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    ws.close();
  }
}

await main();
