import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Types — PaperNexus MCP tool names and their parameter/result contracts
// ---------------------------------------------------------------------------

export type PapernexusMcpToolName =
  | "list_corpora"
  | "corpus_status"
  | "query"
  | "context"
  | "impact"
  | "ideas"
  | "brainstorm"
  | "domain_distance"
  | "extract_takeaways"
  | "interdisciplinary_potential"
  | "mutate_graph"
  | "refresh_corpus";

export type PapernexusMcpToolResult = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

export type PapernexusRemoteMcpTransport = "streamable-http";

export type PapernexusStdioMcpClientConfig = {
  corpusRoot: string;
  transport?: "stdio";
  papernexusBin?: string;
  timeoutMs?: number;
};

export type PapernexusRemoteHttpMcpClientConfig = {
  corpusRoot: string;
  transport: PapernexusRemoteMcpTransport;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type PapernexusMcpClientConfig =
  | PapernexusStdioMcpClientConfig
  | PapernexusRemoteHttpMcpClientConfig;

// ---------------------------------------------------------------------------
// MCP JSON-RPC helpers
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// ---------------------------------------------------------------------------
// Client — spawns PaperNexus MCP server as stdio child process
// ---------------------------------------------------------------------------

export type PapernexusMcpClient = {
  callTool: (
    toolName: PapernexusMcpToolName,
    params?: Record<string, unknown>
  ) => Promise<PapernexusMcpToolResult>;
  close: () => void;
  readonly alive: boolean;
};

export function createPapernexusMcpClient(
  config: PapernexusMcpClientConfig
): PapernexusMcpClient {
  if (config.transport === "streamable-http") {
    return createRemoteHttpPapernexusMcpClient(config);
  }

  return createStdioPapernexusMcpClient(config);
}

function createStdioPapernexusMcpClient(
  config: PapernexusStdioMcpClientConfig
): PapernexusMcpClient {
  const bin = config.papernexusBin ?? "papernexus";
  const timeoutMs = config.timeoutMs ?? 30_000;
  let requestId = 0;
  let child: ChildProcess | null = null;
  let buffer = Buffer.alloc(0);
  let initializePromise: Promise<void> | null = null;

  const pendingRequests = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function ensureChild(): ChildProcess {
    if (child && child.exitCode === null) {
      return child;
    }
    child = spawn(bin, ["mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    buffer = Buffer.alloc(0);
    initializePromise = null;
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      drainBuffer();
    });
    child.on("error", (err) => {
      initializePromise = null;
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      pendingRequests.clear();
    });
    child.on("exit", () => {
      initializePromise = null;
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("PaperNexus MCP process exited unexpectedly"));
      }
      pendingRequests.clear();
    });
    return child;
  }

  function drainBuffer(): void {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const header = buffer.slice(0, headerEnd).toString("utf-8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = Buffer.alloc(0);
        return;
      }

      const bodyLength = Number(lengthMatch[1]);
      const messageEnd = headerEnd + 4 + bodyLength;
      if (buffer.length < messageEnd) {
        return;
      }

      const body = buffer.slice(headerEnd + 4, messageEnd).toString("utf-8");
      buffer = buffer.slice(messageEnd);
      try {
        const parsed = JSON.parse(body) as JsonRpcResponse;
        if (typeof parsed.id === "number" && pendingRequests.has(parsed.id)) {
          const pending = pendingRequests.get(parsed.id)!;
          pendingRequests.delete(parsed.id);
          clearTimeout(pending.timer);
          pending.resolve(parsed);
        }
      } catch {
        // Non-JSON output from the server (e.g. log lines); ignore.
      }
    }
  }

  function sendRequest(
    proc: ChildProcess,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(request.id);
        resolve({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32001,
            message: `MCP tool call '${request.method}' timed out after ${timeoutMs}ms`,
          },
        });
      }, timeoutMs);

      pendingRequests.set(request.id, {
        resolve,
        reject,
        timer,
      });

      const body = Buffer.from(JSON.stringify(request), "utf-8");
      const payload = Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf-8"),
        body,
      ]);
      proc.stdin!.write(payload, (err) => {
        if (err) {
          pendingRequests.delete(request.id);
          clearTimeout(timer);
          resolve({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32002,
              message: `Failed to write to MCP stdin: ${err.message}`,
            },
          });
        }
      });
    });
  }

  async function initialize(proc: ChildProcess): Promise<void> {
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      const response = await sendRequest(proc, {
        jsonrpc: "2.0",
        id: ++requestId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "openclaw-research",
            version: "1.0.0",
          },
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }
    })();

    try {
      await initializePromise;
    } catch (error) {
      initializePromise = null;
      throw error;
    }
  }

  async function callTool(
    toolName: PapernexusMcpToolName,
    params?: Record<string, unknown>
  ): Promise<PapernexusMcpToolResult> {
    const proc = ensureChild();
    await initialize(proc);

    const argumentsPayload = { ...(params ?? {}) };
    if (!Object.prototype.hasOwnProperty.call(argumentsPayload, "corpus")) {
      argumentsPayload.corpus = config.corpusRoot;
    }

    const response = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: argumentsPayload,
      },
    });

    if (response.error) {
      return {
        ok: false,
        data: response.error.data ?? null,
        error: response.error.message,
      };
    }

    return {
      ok: true,
      data: response.result ?? null,
      error: null,
    };
  }

  function close(): void {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MCP client closed"));
    }
    pendingRequests.clear();
    child = null;
    buffer = Buffer.alloc(0);
    initializePromise = null;
  }

  return {
    callTool,
    close,
    get alive() {
      return child !== null && child.exitCode === null;
    },
  };
}

function createRemoteHttpPapernexusMcpClient(
  config: PapernexusRemoteHttpMcpClientConfig
): PapernexusMcpClient {
  const timeoutMs = config.timeoutMs ?? 30_000;
  let requestId = 0;
  let closed = false;

  async function sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (closed) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32003,
          message: "Remote MCP client is closed",
        },
      };
    }

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(config.headers ?? {}),
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await response.text();
      if (!response.ok) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32010,
            message: `Remote MCP HTTP ${response.status}: ${response.statusText}`,
            data: responseText || null,
          },
        };
      }

      try {
        return JSON.parse(responseText) as JsonRpcResponse;
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32700,
            message: `Remote MCP returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            data: responseText,
          },
        };
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32011,
          message: `Remote MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  async function callTool(
    toolName: PapernexusMcpToolName,
    params?: Record<string, unknown>
  ): Promise<PapernexusMcpToolResult> {
    const argumentsPayload = { ...(params ?? {}) };
    if (!Object.prototype.hasOwnProperty.call(argumentsPayload, "corpus")) {
      argumentsPayload.corpus = config.corpusRoot;
    }

    const response = await sendRequest({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: argumentsPayload,
      },
    });

    if (response.error) {
      return {
        ok: false,
        data: response.error.data ?? null,
        error: response.error.message,
      };
    }

    return {
      ok: true,
      data: response.result ?? null,
      error: null,
    };
  }

  return {
    callTool,
    close() {
      closed = true;
    },
    get alive() {
      return !closed;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: one-shot tool call (spawns, calls, closes)
// ---------------------------------------------------------------------------

export async function callPapernexusMcpTool(
  config: PapernexusMcpClientConfig,
  toolName: PapernexusMcpToolName,
  params?: Record<string, unknown>
): Promise<PapernexusMcpToolResult> {
  const client = createPapernexusMcpClient(config);
  try {
    return await client.callTool(toolName, params);
  } finally {
    client.close();
  }
}
