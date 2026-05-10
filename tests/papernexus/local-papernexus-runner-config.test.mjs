import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveLocalPapernexusConfig } from "../../scripts/local_papernexus_config.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("local PaperNexus E2E override reads serve config without persisting the token in summary", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-pn-config-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const configPath = path.join(tempRoot, "config.json");
  await writeJson(configPath, {
    serve: {
      host: "127.0.0.1",
      port: 4821,
      apiToken: "secret-token",
      mcp: {
        enabled: true,
        path: "/mcp",
      },
    },
  });

  const resolved = await resolveLocalPapernexusConfig([
    "node",
    "runner",
    "--use-local-papernexus",
    "--papernexus-local-config-path",
    configPath,
  ], {
    env: {},
  });

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.pluginOverrides.papernexusAccessMode, "remote_mcp");
  assert.equal(resolved.pluginOverrides.papernexusMcpUrl, "http://127.0.0.1:4821/mcp");
  assert.equal(resolved.pluginOverrides.papernexusApiBaseUrl, "http://127.0.0.1:4821");
  assert.equal(resolved.pluginOverrides.papernexusApiTokenSource, "env");
  assert.equal(resolved.pluginOverrides.papernexusAllowLocalMcp, true);
  assert.equal(resolved.envOverrides.PAPERNEXUS_API_TOKEN, "secret-token");
  assert.equal(resolved.envOverrides.PAPERNEXUS_ALLOW_LOCAL_MCP, "1");
  assert.equal(resolved.summary.tokenProvidedBy, "local_config");
  assert.equal(JSON.stringify(resolved.summary).includes("secret-token"), false);
});

test("local PaperNexus E2E override exports explicit shared corpus to child wrappers", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-pn-corpus-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const configPath = path.join(tempRoot, "config.json");
  await writeJson(configPath, {
    serve: {
      host: "127.0.0.1",
      port: 4821,
      apiToken: "secret-token",
      mcp: {
        enabled: true,
        path: "/mcp",
      },
    },
  });

  const resolved = await resolveLocalPapernexusConfig([
    "node",
    "runner",
    "--use-local-papernexus",
    "--papernexus-local-config-path",
    configPath,
    "--papernexus-shared-corpus",
    "GCD",
  ], {
    env: {},
  });

  assert.equal(resolved.pluginOverrides.papernexusSharedCorpus, "GCD");
  assert.equal(resolved.envOverrides.PAPERNEXUS_CORPUS, "GCD");
  assert.equal(resolved.summary.sharedCorpus, "GCD");
  assert.equal(resolved.summary.corpusProvidedBy, "cli");
});

test("remote PaperNexus E2E override exports explicit staging env for wrapper uploads", async () => {
  const resolved = await resolveLocalPapernexusConfig([
    "node",
    "runner",
    "--papernexus-mcp-url",
    "http://10.126.56.30:4821/mcp",
    "--papernexus-access-mode",
    "remote_mcp",
    "--papernexus-shared-corpus",
    "GCD",
    "--papernexus-ssh-target",
    "hyq@10.126.56.30",
    "--papernexus-remote-staging-root",
    "/tmp/papernexus-import-staging",
  ], {
    env: {},
  });

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.pluginOverrides.papernexusMcpUrl, "http://10.126.56.30:4821/mcp");
  assert.equal(resolved.pluginOverrides.papernexusSshTarget, "hyq@10.126.56.30");
  assert.equal(
    resolved.pluginOverrides.papernexusRemoteStagingRoot,
    "/tmp/papernexus-import-staging"
  );
  assert.equal(resolved.envOverrides.PAPERNEXUS_CORPUS, "GCD");
  assert.equal(resolved.envOverrides.PAPERNEXUS_SSH_TARGET, "hyq@10.126.56.30");
  assert.equal(
    resolved.envOverrides.PAPERNEXUS_REMOTE_STAGING_ROOT,
    "/tmp/papernexus-import-staging"
  );
  assert.equal(resolved.summary.sshTargetProvidedBy, "cli");
  assert.equal(resolved.summary.remoteStagingRootProvidedBy, "cli");
});

test("remote PaperNexus E2E override preserves runtime auth instead of reusing local serve token", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-remote-pn-config-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const configPath = path.join(tempRoot, "config.json");
  await writeJson(configPath, {
    serve: {
      host: "127.0.0.1",
      port: 4821,
      apiToken: "secret-token",
      mcp: {
        enabled: true,
        path: "/mcp",
      },
    },
  });

  const resolved = await resolveLocalPapernexusConfig([
    "node",
    "runner",
    "--papernexus-mcp-url",
    "http://10.126.56.30:4821/mcp",
    "--papernexus-local-config-path",
    configPath,
    "--papernexus-shared-corpus",
    "GCD",
  ], {
    env: {},
  });

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.pluginOverrides.papernexusAccessMode, "remote_mcp");
  assert.equal(resolved.pluginOverrides.papernexusMcpUrl, "http://10.126.56.30:4821/mcp");
  assert.equal(resolved.pluginOverrides.papernexusApiBaseUrl, undefined);
  assert.equal(resolved.pluginOverrides.papernexusAllowLocalMcp, undefined);
  assert.equal(resolved.pluginOverrides.papernexusApiTokenSource, undefined);
  assert.equal(resolved.pluginOverrides.papernexusApiTokenEnv, "PAPERNEXUS_API_TOKEN");
  assert.equal(resolved.envOverrides.PAPERNEXUS_API_TOKEN, undefined);
  assert.equal(resolved.envOverrides.PAPERNEXUS_ALLOW_LOCAL_MCP, undefined);
  assert.equal(resolved.summary.tokenProvidedBy, "runtime_access");
  assert.equal(JSON.stringify(resolved.summary).includes("secret-token"), false);
});

test("remote PaperNexus E2E override uses explicit environment token when present", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-remote-pn-env-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const configPath = path.join(tempRoot, "config.json");
  await writeJson(configPath, {
    serve: {
      host: "127.0.0.1",
      port: 4821,
      apiToken: "local-only-token",
      mcp: {
        enabled: true,
        path: "/mcp",
      },
    },
  });

  const resolved = await resolveLocalPapernexusConfig([
    "node",
    "runner",
    "--papernexus-mcp-url",
    "http://10.126.56.30:4821/mcp",
    "--papernexus-local-config-path",
    configPath,
  ], {
    env: {
      PAPERNEXUS_API_TOKEN: "remote-env-token",
    },
  });

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.pluginOverrides.papernexusAccessMode, "remote_mcp");
  assert.equal(resolved.pluginOverrides.papernexusMcpUrl, "http://10.126.56.30:4821/mcp");
  assert.equal(resolved.pluginOverrides.papernexusApiTokenSource, "env");
  assert.equal(resolved.envOverrides.PAPERNEXUS_API_TOKEN, undefined);
  assert.equal(resolved.summary.tokenProvidedBy, "environment");
  assert.equal(JSON.stringify(resolved.summary).includes("remote-env-token"), false);
  assert.equal(JSON.stringify(resolved.summary).includes("local-only-token"), false);
});
