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

test("install.sh falls back when openclaw agents list hangs during duplicate-skill inspection", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-timeout-test-")
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
  sleep 2
  printf '[]\\n'
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  const startedAt = Date.now();
  const { code, stdout, stderr } = await spawnInstallScript(["--dry-run", "--yes"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH ?? ""}`,
      OPENCLAW_HOME: path.join(tempRoot, ".openclaw"),
      PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
      OPENCLAW_AGENTS_LIST_TIMEOUT_SECONDS: "1",
      HOME: path.join(tempRoot, "home"),
    },
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(code, 0, stderr);
  assert.match(stdout, /\[5\/8\] 检查重复技能/);
  assert.match(stderr, /WARN: openclaw agents list --json 在 1s 内未返回/);
  assert.match(stdout, /\[6\/8\] 复制技能到 Agent 工作区 skills/);
  assert.ok(
    elapsedMs < 8000,
    `expected cached timeout fallback to finish quickly, got ${elapsedMs}ms`
  );
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
  assert.match(stdout, /\[1\/8\] 同步最新 Git 代码/);
  assert.match(stdout, /\[3\/8\] 添加 Agents/);
  assert.match(stdout, /SKIP 添加 Agents|SKIP 全部 Agent 创建/);
  assert.match(stdout, /\[6\/8\] 复制技能到 Agent 工作区 skills/);
  assert.match(stdout, /\[8\/8\] 同步工作区配置、模板和角色根配置/);
  assert.match(stdout, /SKIP 同步工作区配置/);
});

test("install.sh refreshes PaperNexus-sourced workspace skills without duplicate prompt", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-papernexus-refresh-test-")
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const pluginDir = path.join(tempRoot, "plugin");
  const openclawHome = path.join(tempRoot, ".openclaw");
  const workspaceDir = path.join(openclawHome, "workspace-researcher");
  const paperNexusDir = path.join(tempRoot, "PaperNexus");
  const paperNexusSkillDir = path.join(paperNexusDir, "SKILL", "PaperNexus");
  const paperNexusAgenticSkillDir = path.join(
    paperNexusDir,
    "SKILL",
    "PaperNexusAgenticReasoning"
  );
  const workspaceSkillDir = path.join(workspaceDir, "skills", "papernexus");
  const workspaceAgenticSkillDir = path.join(
    workspaceDir,
    "skills",
    "papernexus-agentic-reasoning"
  );

  await fs.mkdir(path.join(pluginDir, "skills", "researcher", "papernexus"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(pluginDir, "skills", "researcher", "papernexus", "SKILL.md"),
    "---\nname: papernexus\n---\nold plugin skill\n",
    "utf8"
  );
  await fs.mkdir(path.join(pluginDir, "skills"), { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "skills", "index.json"),
    `${JSON.stringify({ researcher: ["./researcher/papernexus"] }, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(workspaceSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(workspaceSkillDir, "SKILL.md"),
    "---\nname: papernexus\n---\nold workspace skill\n",
    "utf8"
  );

  await fs.mkdir(path.join(paperNexusSkillDir, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(paperNexusSkillDir, "SKILL.md"),
    "---\nname: papernexus\ndescription: latest PaperNexus skill\n---\nnew PaperNexus skill\npython3 SKILL/PaperNexus/scripts/pn_batch_import.py\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(paperNexusSkillDir, "scripts", "pn_batch_import.py"),
    "# latest wrapper\n",
    "utf8"
  );
  await fs.mkdir(path.join(paperNexusAgenticSkillDir, "scripts"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(paperNexusAgenticSkillDir, "SKILL.md"),
    "---\nname: papernexus-agentic-reasoning\n---\npython3 SKILL/PaperNexusAgenticReasoning/scripts/pn_batch_import.py\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(paperNexusAgenticSkillDir, "scripts", "pn_batch_import.py"),
    `#!/usr/bin/env python3
from pathlib import Path
import runpy
import sys


TARGET = Path(__file__).resolve().parents[2] / "PaperNexus" / "scripts" / "pn_batch_import.py"
sys.path.insert(0, str(TARGET.parent))
runpy.run_path(str(TARGET), run_name="__main__")
`,
    "utf8"
  );

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
    "workspace": "${workspaceDir}"
  }
]
EOF
  exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  const { code, stdout, stderr } = await spawnInstallScript(["--skip-build"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENCLAW_INSTALL_FORCE_MENU: "1",
      PATH: `${mockBin}:${process.env.PATH ?? ""}`,
      OPENCLAW_HOME: openclawHome,
      PAPERNEXUS_DIR: paperNexusDir,
      PLUGIN_DIR: pluginDir,
      HOME: path.join(tempRoot, "home"),
    },
    input: "2\n",
  });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /PaperNexus source will refresh automatically/);
  assert.match(stdout, /REFRESH researcher\/papernexus \(PaperNexus source\)/);

  const refreshedSkill = await fs.readFile(
    path.join(workspaceSkillDir, "SKILL.md"),
    "utf8"
  );
  const refreshedWrapper = await fs.readFile(
    path.join(workspaceSkillDir, "scripts", "pn_batch_import.py"),
    "utf8"
  );
  assert.match(refreshedSkill, /new PaperNexus skill/);
  assert.match(refreshedSkill, /python3 skills\/papernexus\/scripts\/pn_batch_import\.py/);
  assert.doesNotMatch(refreshedSkill, /SKILL\/PaperNexus\/scripts/);
  assert.match(refreshedWrapper, /latest wrapper/);

  const refreshedAgenticSkill = await fs.readFile(
    path.join(workspaceAgenticSkillDir, "SKILL.md"),
    "utf8"
  );
  const refreshedAgenticWrapper = await fs.readFile(
    path.join(workspaceAgenticSkillDir, "scripts", "pn_batch_import.py"),
    "utf8"
  );
  assert.match(
    refreshedAgenticSkill,
    /python3 skills\/papernexus-agentic-reasoning\/scripts\/pn_batch_import\.py/
  );
  assert.doesNotMatch(
    refreshedAgenticWrapper,
    /TARGET = Path\(__file__\)\.resolve\(\)\.parents\[2\].*"PaperNexus"/
  );
  assert.doesNotMatch(refreshedAgenticWrapper, /"PaperNexus" \/ "scripts"/);
  assert.match(refreshedAgenticWrapper, /_resolve_papernexus_script/);
  assert.match(refreshedAgenticWrapper, /"papernexus" \/ "scripts"/);
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
  assert.match(stdout, /\[dry-run\] \(cd .* && git pull --ff-only\)|SKIP Git 同步（当前分支未设置 upstream）/);
  assert.match(stdout, /\[2\/8\] 编译最新插件代码/);
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

test("install.sh repairs existing agent models.json drift even when agent creation is skipped", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-agent-model-sync-test-")
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const openclawHome = path.join(tempRoot, ".openclaw");
  const agentDir = path.join(openclawHome, "agents", "academic_writer", "agent");
  const workspaceDir = path.join(openclawHome, "workspace-academic_writer");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  await fs.writeFile(
    path.join(openclawHome, "openclaw.json"),
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                { id: "qwen3.5-plus", name: "qwen3.5-plus" },
                { id: "qwen3.6-plus", name: "qwen3.6-plus" },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: ["bailian/qwen3.5-plus"],
            },
          },
          list: [
            {
              id: "academic_writer",
              workspace: workspaceDir,
              agentDir,
              model: {
                primary: "bailian/qwen3.6-plus",
                fallbacks: ["bailian/qwen3.5-plus"],
              },
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          bailian: {
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            apiKey: "test-key",
            api: "openai-completions",
            models: [{ id: "qwen3.5-plus", name: "qwen3.5-plus" }],
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const mockBin = path.join(tempRoot, "bin");
  await writeExecutable(
    path.join(mockBin, "openclaw"),
    `#!/bin/sh
if [ "$1" = "agents" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  cat <<'EOF'
[
  {
    "id": "academic_writer",
    "workspace": "${workspaceDir}"
  }
]
EOF
  exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );
  await writeExecutable(
    path.join(mockBin, "git"),
    `#!/bin/sh
if [ "$1" = "-C" ]; then
  shift 2
fi
case "$1" in
  rev-parse)
    echo true
    exit 0
    ;;
  pull)
    exit 0
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 1
`
  );
  await writeExecutable(
    path.join(mockBin, "npm"),
    `#!/bin/sh
exit 0
`
  );

  const repoRoot = process.cwd();
  const { code, stdout, stderr } = await spawnInstallScript(
    ["--yes", "--skip-build", "--skip-extra-agents"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        OPENCLAW_HOME: openclawHome,
        PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
        HOME: path.join(tempRoot, "home"),
      },
    }
  );

  assert.equal(code, 0, stderr);
  assert.match(stdout, /REPAIR academic_writer added=bailian\/qwen3\.6-plus/);

  const nextModels = JSON.parse(
    await fs.readFile(path.join(agentDir, "models.json"), "utf8")
  );
  assert.deepEqual(
    nextModels.providers.bailian.models.map((entry) => entry.id),
    ["qwen3.5-plus", "qwen3.6-plus"]
  );
});

test("install.sh repairs existing agent models.json drift during skills-only installs", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-install-skills-model-sync-test-")
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const openclawHome = path.join(tempRoot, ".openclaw");
  const agentDir = path.join(openclawHome, "agents", "academic_writer", "agent");
  const workspaceDir = path.join(openclawHome, "workspace-academic_writer");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  await fs.writeFile(
    path.join(openclawHome, "openclaw.json"),
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                { id: "qwen3.5-plus", name: "qwen3.5-plus" },
                { id: "qwen3.6-plus", name: "qwen3.6-plus" },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: ["bailian/qwen3.5-plus"],
            },
          },
          list: [
            {
              id: "academic_writer",
              workspace: workspaceDir,
              agentDir,
              model: {
                primary: "bailian/qwen3.6-plus",
                fallbacks: ["bailian/qwen3.5-plus"],
              },
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          bailian: {
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            apiKey: "test-key",
            api: "openai-completions",
            models: [{ id: "qwen3.5-plus", name: "qwen3.5-plus" }],
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const mockBin = path.join(tempRoot, "bin");
  await writeExecutable(
    path.join(mockBin, "openclaw"),
    `#!/bin/sh
if [ "$1" = "agents" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  cat <<'EOF'
[
  {
    "id": "academic_writer",
    "workspace": "${workspaceDir}"
  }
]
EOF
  exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then
  exit 0
fi
echo "unexpected openclaw invocation: $*" >&2
exit 1
`
  );
  await writeExecutable(
    path.join(mockBin, "git"),
    `#!/bin/sh
if [ "$1" = "-C" ]; then
  shift 2
fi
case "$1" in
  rev-parse)
    echo true
    exit 0
    ;;
  pull)
    exit 0
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 1
`
  );

  const repoRoot = process.cwd();
  const { code, stdout, stderr } = await spawnInstallScript(
    ["--skip-build", "--skip-extra-agents"],
    {
      cwd: repoRoot,
      input: "2\n",
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        OPENCLAW_HOME: openclawHome,
        OPENCLAW_INSTALL_FORCE_MENU: "1",
        PAPERNEXUS_DIR: path.join(tempRoot, "missing-papernexus"),
        HOME: path.join(tempRoot, "home"),
      },
    }
  );

  assert.equal(code, 0, stderr);
  assert.match(stdout, /Mode:\s+SKILLS ONLY/);
  assert.match(stdout, /REPAIR academic_writer added=bailian\/qwen3\.6-plus/);

  const nextModels = JSON.parse(
    await fs.readFile(path.join(agentDir, "models.json"), "utf8")
  );
  assert.deepEqual(
    nextModels.providers.bailian.models.map((entry) => entry.id),
    ["qwen3.5-plus", "qwen3.6-plus"]
  );
});
