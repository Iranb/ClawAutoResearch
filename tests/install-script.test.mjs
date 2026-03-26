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
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o755 });
}

test("install.sh tolerates noisy stdout after openclaw JSON output", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-test-")
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const mockBin = path.join(tempRoot, "bin");
  const mockOpenclaw = path.join(mockBin, "openclaw");
  await writeExecutable(
    mockOpenclaw,
    `#!/bin/sh
if [ "$1" = "agents" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  cat <<'EOF'
[
  {
    "id": "researcher",
    "workspace": "/tmp/mock-workspace-researcher"
  },
  {
    "id": "reviewer",
    "workspace": "/tmp/mock-workspace-reviewer"
  }
]
16:33:56 [agents/auth-profiles] read codex credentials from keychain
16:33:58 [agents/auth-profiles] read codex credentials from keychain
EOF
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  const { stdout, stderr } = await execFileAsync("bash", ["install.sh", "--dry-run", "--skip-agent-create"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH ?? ""}`,
      OPENCLAW_HOME: path.join(tempRoot, ".openclaw"),
      PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
      HOME: path.join(tempRoot, "home"),
    },
  });

  assert.match(stdout, /Installation Preview Complete/);
  assert.doesNotMatch(stdout, /jq: parse error/i);
  assert.doesNotMatch(stderr, /jq: parse error/i);
});
