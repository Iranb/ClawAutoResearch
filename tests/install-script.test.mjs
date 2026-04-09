import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o755 });
}

async function spawnInstallScript(args, { cwd, env, input = "" }) {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["install.sh", ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(input);
  });
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

test("install.sh offers quick menu and can run skills-only mode", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-menu-test-")
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
  printf '[]\n'
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  const { code, stdout, stderr } = await spawnInstallScript(["--dry-run"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENCLAW_INSTALL_FORCE_MENU: "1",
      PATH: `${mockBin}:${process.env.PATH ?? ""}`,
      OPENCLAW_HOME: path.join(tempRoot, ".openclaw"),
      PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
      HOME: path.join(tempRoot, "home"),
    },
    input: "2\n",
  });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /1\. 完整安装/);
  assert.match(stdout, /2\. 仅同步 skills/);
  assert.match(stdout, /3\. 仅同步 workspace/);
  assert.match(stdout, /4\. 高级自定义/);
  assert.match(stdout, /Mode:\s+SKILLS ONLY/);
  assert.match(stdout, /\[1\/7\] 添加 Agents/);
  assert.match(stdout, /SKIP 添加 Agents|SKIP 全部 Agent 创建/);
  assert.match(stdout, /\[4\/7\] 复制技能到 Agent 工作区 skills/);
  assert.match(stdout, /\[6\/7\] 同步工作区配置、模板和角色根配置/);
  assert.match(stdout, /SKIP 同步工作区配置/);
});

test("install.sh defaults to no agent creation, previews build, and syncs optional agent markdown", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-default-full-test-")
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
  printf '[]\\n'
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  await fs.mkdir(path.join(tempRoot, ".openclaw", "workspace-planner"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tempRoot, ".openclaw", "workspace-planner", "AGENTS.md"),
    "old planner config\n",
    "utf8"
  );

  const { code, stdout, stderr } = await spawnInstallScript(["--dry-run", "--yes"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH ?? ""}`,
      OPENCLAW_HOME: path.join(tempRoot, ".openclaw"),
      PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
      HOME: path.join(tempRoot, "home"),
    },
  });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /Mode:\s+FULL INSTALL/);
  assert.match(stdout, /\[ Build \] 编译最新插件代码/);
  assert.match(stdout, /\[dry-run\] \(cd .* && npm run build\)/);
  assert.match(stdout, /SKIP 全部 Agent 创建（默认关闭；使用 --with-agent-create 开启）/);
  assert.match(stdout, /-> UPDATE workspace-planner\/AGENTS\.md/);
  assert.match(stdout, /\[dry-run\] openclaw gateway restart/);
  assert.doesNotMatch(stdout, /workspace-planner\/AGENTS\.md \(已存在；默认会覆盖，当前因 --preserve-role-files 保留\)/);
});

test("install.sh can preserve existing agent markdown when requested", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-preserve-role-test-")
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
  printf '[]\\n'
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  await fs.mkdir(path.join(tempRoot, ".openclaw", "workspace-planner"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tempRoot, ".openclaw", "workspace-planner", "AGENTS.md"),
    "old planner config\n",
    "utf8"
  );

  const { code, stdout, stderr } = await spawnInstallScript(
    ["--dry-run", "--yes", "--preserve-role-files"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        OPENCLAW_HOME: path.join(tempRoot, ".openclaw"),
        PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
        HOME: path.join(tempRoot, "home"),
      },
    }
  );

  assert.equal(code, 0, stderr);
  assert.match(stdout, /Role MD:\s+preserve existing agent markdown\/hooks/);
  assert.match(
    stdout,
    /workspace-planner\/AGENTS\.md \(已存在；默认会覆盖，当前因 --preserve-role-files 保留\)/
  );
});
