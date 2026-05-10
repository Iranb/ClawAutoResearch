import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectPapernexusRemoteAccess,
  normalizePapernexusAccessMode,
  normalizePapernexusApiTokenSource,
  resolvePapernexusAccessPath,
  summarizePapernexusRemoteAccessConfig,
} from "../../tools/papernexus-secret.ts";

test("normalizePapernexusApiTokenSource defaults unknown values to auto", () => {
  assert.equal(normalizePapernexusApiTokenSource(undefined), "auto");
  assert.equal(normalizePapernexusApiTokenSource("ENV"), "env");
  assert.equal(normalizePapernexusApiTokenSource("os_keychain"), "os_keychain");
  assert.equal(normalizePapernexusApiTokenSource("weird"), "auto");
});

test("normalizePapernexusAccessMode recognizes remote_mcp", () => {
  assert.equal(normalizePapernexusAccessMode("remote_mcp"), "remote_mcp");
  assert.equal(normalizePapernexusAccessMode("REMOTE-MCP"), "remote_mcp");
  assert.equal(normalizePapernexusAccessMode("local_mcp"), "local_mcp");
  assert.equal(normalizePapernexusAccessMode("remote_api"), "remote_api");
  assert.equal(normalizePapernexusAccessMode("weird"), "auto");
});

test("summarizePapernexusRemoteAccessConfig carries explicit local MCP allowance", () => {
  const summary = summarizePapernexusRemoteAccessConfig({
    mcpUrl: "http://127.0.0.1:4821/mcp",
    allowLocalMcp: true,
  });

  assert.equal(summary.mcpUrl, "http://127.0.0.1:4821/mcp");
  assert.equal(summary.allowLocalMcp, true);
});

test("inspectPapernexusRemoteAccess resolves token from env when configured", async () => {
  const result = await inspectPapernexusRemoteAccess(
    {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
      tokenService: "papernexus-api-token",
      tokenAccount: "default",
    },
    {
      env: {
        PAPERNEXUS_API_TOKEN: "secret-from-env",
      },
      platform: "darwin",
    }
  );

  assert.equal(result.tokenAvailable, true);
  assert.equal(result.tokenSourceResolved, "env");
  assert.equal(result.tokenError, null);
  assert.equal(result.summary.tokenSourceConfigured, "env");
  assert.equal(result.summary.tokenEnv, "PAPERNEXUS_API_TOKEN");
  assert.equal(result.summary.tokenService, "papernexus-api-token");
  assert.equal(result.token, "secret-from-env");
});

test("inspectPapernexusRemoteAccess does not probe keychain when remote access is unconfigured", async () => {
  let called = false;
  const result = await inspectPapernexusRemoteAccess(
    {},
    {
      commandRunner: async () => {
        called = true;
        return {
          ok: true,
          stdout: "should-not-run",
          stderr: "",
          exitCode: 0,
        };
      },
    }
  );

  assert.equal(result.tokenAvailable, false);
  assert.equal(result.tokenSourceResolved, null);
  assert.equal(result.tokenError, "PaperNexus remote access is not configured.");
  assert.equal(called, false);
});

test("inspectPapernexusRemoteAccess falls back to macOS Keychain in auto mode", async () => {
  const calls = [];
  const result = await inspectPapernexusRemoteAccess(
    {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "auto",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
      tokenService: "papernexus-api-token",
      tokenAccount: "default",
    },
    {
      env: {},
      platform: "darwin",
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return {
          ok: true,
          stdout: "secret-from-keychain\n",
          stderr: "",
          exitCode: 0,
        };
      },
    }
  );

  assert.equal(result.tokenAvailable, true);
  assert.equal(result.tokenSourceResolved, "os_keychain");
  assert.equal(result.token, "secret-from-keychain");
  assert.deepEqual(calls, [
    {
      command: "security",
      args: [
        "find-generic-password",
        "-s",
        "papernexus-api-token",
        "-a",
        "default",
        "-w",
      ],
    },
  ]);
});

test("inspectPapernexusRemoteAccess uses Windows PasswordVault lookup on win32", async () => {
  const calls = [];
  const result = await inspectPapernexusRemoteAccess(
    {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "os_keychain",
      tokenService: "papernexus-api-token",
      tokenAccount: "default",
    },
    {
      env: {},
      platform: "win32",
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return {
          ok: true,
          stdout: "secret-from-vault",
          stderr: "",
          exitCode: 0,
        };
      },
    }
  );

  assert.equal(result.tokenAvailable, true);
  assert.equal(result.tokenSourceResolved, "os_keychain");
  assert.equal(result.token, "secret-from-vault");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.match(calls[0].args.join(" "), /PasswordVault/);
  assert.match(calls[0].args.join(" "), /papernexus-api-token/);
  assert.match(calls[0].args.join(" "), /default/);
});

test("resolvePapernexusAccessPath resolves remote_mcp when MCP URL and token are configured", async () => {
  const result = await resolvePapernexusAccessPath(
    {
      mcpUrl: "https://papernexus.example/mcp",
      mcpTransport: "streamable-http",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
    {
      accessMode: "remote_mcp",
      corpusRoot: "GCD",
      env: {
        PAPERNEXUS_API_TOKEN: "secret-from-env",
      },
    }
  );

  assert.equal(result.mode, "remote_mcp");
  assert.equal(result.error, null);
  assert.equal(result.corpusRoot, "GCD");
  assert.equal(result.remoteInspection?.summary.mcpUrl, "https://papernexus.example/mcp");
  assert.equal(result.remoteInspection?.summary.mcpTransport, "streamable-http");
});

test("resolvePapernexusAccessPath prefers remote_mcp in auto mode when both remote_mcp and remote_api are configured", async () => {
  const result = await resolvePapernexusAccessPath(
    {
      apiBaseUrl: "https://papernexus.example/api",
      mcpUrl: "https://papernexus.example/mcp",
      mcpTransport: "streamable-http",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
    {
      accessMode: "auto",
      corpusRoot: "GCD",
      env: {
        PAPERNEXUS_API_TOKEN: "secret-from-env",
      },
      checkLocalBin: async () => false,
    }
  );

  assert.equal(result.mode, "remote_mcp");
  assert.equal(result.error, null);
});

test("resolvePapernexusAccessPath reports remote_mcp as unavailable when no MCP URL is configured", async () => {
  const result = await resolvePapernexusAccessPath(
    {
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
    {
      accessMode: "remote_mcp",
      corpusRoot: "GCD",
      env: {
        PAPERNEXUS_API_TOKEN: "secret-from-env",
      },
    }
  );

  assert.equal(result.mode, "unavailable");
  assert.match(result.error ?? "", /mcp url/i);
});
