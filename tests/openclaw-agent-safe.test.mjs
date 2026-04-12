import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

test("openclaw_agent_safe returns ok payload when the child emits output and exits", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-safe-"));
  const binDir = path.join(root, "bin");
  const previousPath = process.env.PATH;

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "openclaw"),
    `#!/bin/sh
if [ "$1" = "agent" ]; then
  echo '{"child":"ok"}'
  exit 0
fi
exit 1
`
  );

  const { stdout } = await execFileAsync(
    "node",
    ["scripts/openclaw_agent_safe.mjs", "--json", "--message", "status"],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const payload = JSON.parse(stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.exitCode, 0);
  assert.match(payload.stdout, /child/);
});

test("openclaw_agent_safe terminates silent child processes with a structured timeout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-safe-"));
  const binDir = path.join(root, "bin");
  const previousPath = process.env.PATH;

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "openclaw"),
    `#!/bin/sh
if [ "$1" = "agent" ]; then
  sleep 5
  exit 0
fi
exit 1
`
  );

  const { stdout } = await execFileAsync(
    "node",
    [
      "scripts/openclaw_agent_safe.mjs",
      "--silence-timeout-seconds",
      "1",
      "--startup-grace-seconds",
      "0",
      "--json",
      "--message",
      "status",
    ],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const payload = JSON.parse(stdout);
  assert.equal(payload.status, "timed_out_silent");
  assert.equal(payload.signal, "SIGTERM");
  assert.equal(payload.silenceTimeoutSeconds, 1);
});
