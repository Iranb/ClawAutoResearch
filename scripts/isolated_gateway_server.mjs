import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (typeof port === "number") {
          resolve(port);
        } else {
          reject(new Error("Failed to resolve free port"));
        }
      });
    });
    server.on("error", reject);
  });
}

export async function waitForPort(params) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    const connected = await Promise.race([
      new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port: params.port });
        const finish = (ok) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(ok);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.setTimeout(500, () => finish(false));
      }),
      params.exitPromise
        ? params.exitPromise.then((exit) => {
            throw new Error(
              `isolated gateway exited before opening port ${params.port} (code=${exit.code ?? "null"}, signal=${exit.signal ?? "null"})`
            );
          })
        : new Promise(() => {}),
    ]);
    if (connected) {
      return;
    }
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 250)),
      params.exitPromise
        ? params.exitPromise.then((exit) => {
            throw new Error(
              `isolated gateway exited before opening port ${params.port} (code=${exit.code ?? "null"}, signal=${exit.signal ?? "null"})`
            );
          })
        : new Promise(() => {}),
    ]);
  }
  throw new Error(`Timed out waiting for isolated gateway on port ${params.port}`);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

export async function startIsolatedGateway(params = {}) {
  const sourceConfigPath =
    params.sourceConfigPath ??
    `${process.env.HOME}/.openclaw/openclaw.json`;
  const sourceConfig = clone(await readJson(sourceConfigPath));
  if (!sourceConfig || typeof sourceConfig !== "object") {
    throw new Error(`Failed to read source OpenClaw config: ${sourceConfigPath}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-isolated-gateway-"));
  const stateDir = path.join(tempRoot, "state");
  const configPath = path.join(tempRoot, "openclaw.json");
  const port = params.port ?? (await getFreePort());
  const token = params.token ?? `isolated-${randomUUID()}`;
  const projectsRoot = params.projectsRoot ?? path.join(tempRoot, "projects");

  const nextConfig = clone(sourceConfig);
  if (nextConfig.channels && typeof nextConfig.channels === "object") {
    delete nextConfig.channels["openclaw-weixin"];
  }
  if (
    nextConfig.plugins?.entries &&
    typeof nextConfig.plugins.entries === "object"
  ) {
    delete nextConfig.plugins.entries["openclaw-weixin"];
  }
  nextConfig.gateway = {
    ...(nextConfig.gateway ?? {}),
    mode: "local",
    bind: "loopback",
    port,
    auth: {
      mode: "token",
      token,
    },
  };

  nextConfig.plugins = nextConfig.plugins ?? {};
  nextConfig.plugins.entries = nextConfig.plugins.entries ?? {};
  const currentResearchPlugin = clone(nextConfig.plugins.entries.ClawAutoResearch ?? {});
  nextConfig.plugins.entries.ClawAutoResearch = {
    ...currentResearchPlugin,
    enabled: true,
    config: {
      ...(currentResearchPlugin.config ?? {}),
      ...(params.pluginConfigOverrides ?? {}),
      projectsRoot,
      enableChannelProjectBindings: true,
      heartbeatBackgroundChecks: true,
      enableWorkflowMailbox: true,
    },
  };

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  const child = spawn(
    "openclaw",
    [
      "gateway",
      "run",
      "--allow-unconfigured",
      "--bind",
      "loopback",
      "--port",
      String(port),
      "--token",
      token,
    ],
    {
      env: {
        ...process.env,
        OPENCLAW_PROJECT: "",
        OPENCLAW_PROJECTS_ROOT: "",
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_GATEWAY_TOKEN: token,
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_SKIP_CHANNELS: "1",
        OPENCLAW_SKIP_GMAIL_WATCHER: "1",
        OPENCLAW_SKIP_CRON: "1",
        OPENCLAW_SKIP_CANVAS_HOST: "1",
        ...(params.envOverrides ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const stdout = [];
  const stderr = [];
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      resolve({ code: null, signal: `spawn_error:${error.message}` });
    });
  });
  child.stdout?.on("data", (chunk) => {
    stdout.push(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderr.push(String(chunk));
  });

  try {
    await waitForPort({ port, timeoutMs: params.timeoutMs ?? 90_000, exitPromise });
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `Failed to start isolated gateway: ${error instanceof Error ? error.message : String(error)}\n${stderr.join("")}`
    );
  }

  return {
    tempRoot,
    stateDir,
    configPath,
    projectsRoot,
    port,
    token,
    url: `ws://127.0.0.1:${port}`,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", () => resolve(true));
        setTimeout(() => resolve(true), 5_000);
      });
    },
    logs: {
      get stdout() {
        return stdout.join("");
      },
      get stderr() {
        return stderr.join("");
      },
    },
  };
}
