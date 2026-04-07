import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createPapernexusMcpClient } from "../tools/papernexus-packets/mcp-client.ts";

async function writeFakePapernexusServer() {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-papernexus-mcp-")
  );
  const serverPath = path.join(tempRoot, "fake-papernexus");
  const script = String.raw`#!/usr/bin/env node
const expectedCommand = "mcp";
if (process.argv[2] !== expectedCommand) {
  process.stderr.write("expected papernexus mcp\n");
  process.exit(2);
}

let initialized = false;
let buffer = Buffer.alloc(0);

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
  process.stdout.write(body);
}

function handleMessage(message) {
  if (message.method === "initialize") {
    initialized = true;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: "fake-papernexus",
          version: "1.0.0"
        }
      }
    });
    return;
  }

  if (message.method === "tools/call") {
    if (!initialized) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: "initialize must be called before tools/call"
        }
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              toolName: message.params?.name ?? null,
              corpus: message.params?.arguments?.corpus ?? null
            })
          }
        ]
      }
    });
    return;
  }

  send({
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: "unsupported method"
    }
  });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      process.stderr.write("missing Content-Length\n");
      process.exit(3);
    }

    const bodyLength = Number(match[1]);
    const messageEnd = headerEnd + 4 + bodyLength;
    if (buffer.length < messageEnd) {
      return;
    }

    const body = buffer.slice(headerEnd + 4, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    handleMessage(JSON.parse(body));
  }
});
`;
  await fs.writeFile(serverPath, script, "utf8");
  await fs.chmod(serverPath, 0o755);
  return { tempRoot, serverPath };
}

test("Papernexus MCP client uses stdio framing and binds the configured corpus", async (t) => {
  const { tempRoot, serverPath } = await writeFakePapernexusServer();
  const corpusRoot = path.join(tempRoot, "demo-corpus");
  const client = createPapernexusMcpClient({
    corpusRoot,
    papernexusBin: serverPath,
    timeoutMs: 5_000,
  });

  t.after(async () => {
    client.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const result = await client.callTool("query", {
    query: "metacontrol",
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(typeof result.data, "object");

  const payload = JSON.parse(result.data.content[0].text);
  assert.deepEqual(payload, {
    toolName: "query",
    corpus: corpusRoot,
  });
});

test("Papernexus MCP client supports remote streamable-http transport and forwards auth headers", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const bodyChunks = [];
    for await (const chunk of request) {
      bodyChunks.push(chunk);
    }
    const raw = Buffer.concat(bodyChunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body: raw ? JSON.parse(raw) : null,
    });

    const payload = {
      jsonrpc: "2.0",
      id: requests[requests.length - 1].body?.id ?? 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              toolName: requests[requests.length - 1].body?.params?.name ?? null,
              corpus:
                requests[requests.length - 1].body?.params?.arguments?.corpus ?? null,
            }),
          },
        ],
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": encoded.length,
    });
    response.end(encoded);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);

  const client = createPapernexusMcpClient({
    transport: "streamable-http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: {
      Authorization: "Bearer remote-secret",
    },
    corpusRoot: "GCD",
    timeoutMs: 5_000,
  });

  t.after(async () => {
    client.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const result = await client.callTool("query", {
    query: "metacontrol",
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(typeof result.data, "object");

  const payload = JSON.parse(result.data.content[0].text);
  assert.deepEqual(payload, {
    toolName: "query",
    corpus: "GCD",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/mcp");
  assert.equal(requests[0].authorization, "Bearer remote-secret");
  assert.equal(requests[0].body?.method, "tools/call");
  assert.equal(requests[0].body?.params?.arguments?.corpus, "GCD");
});
