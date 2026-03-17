# CONFIG.md — 项目根目录与多服务器配置

> `projectsRoot` 建议放在 OpenClaw 的 `openclaw.json`；`servers` 不放在 openclaw.json，统一放在 `~/.openclaw/openclaw-research.json`，并可被项目级 `{PROJ}/servers.json` 覆盖。

---

## 1. 项目根目录（projectsRoot）

**目的**：项目数据与各 agent 的 workspace 分离，由你**指定一个统一目录**，所有 agent（researcher、coder、reviewer 等）都可访问该目录下的项目。

- 在 **openclaw.json** 中配置顶层键 **`projectsRoot`**，例如：
  ```json
  projectsRoot: "~/.openclaw/projects"
  ```
  可改为任意路径，如 `"/Users/me/ResearchProjects"` 或 `"~/OpenClawProjects"`。
- **项目路径**：`{PROJECTS_ROOT}/{proj-id}/`；**项目级记忆**：`{PROJECTS_ROOT}/{proj-id}/memory/`（ideation-memory、experiment-memory、每日日志）。
- Agent 解析 **{PROJECTS_ROOT}** 的顺序：环境变量 `OPENCLAW_PROJECTS_ROOT` → 文件 `~/.openclaw/openclaw-research.json` 的 `projectsRoot` 键 → 默认 `~/.openclaw/projects`。  
  安装脚本会将 openclaw.json 中的 `projectsRoot` 同步到 `~/.openclaw/openclaw-research.json`，便于各 agent 读取。
- **PROJECTS_STATE.json** 放在项目根下：`{PROJECTS_ROOT}/PROJECTS_STATE.json`，便于多 agent 共享。

---

## 2. 多台服务器（全局与按项目）

**问题**：默认 `tools.exec.host` 仅支持单台主机，多台 GPU 服务器时需要指定或轮询不同 host；且**不同研究方向/项目可能使用不同服务器**。

**做法**：

1. **全局默认**：在 `~/.openclaw/openclaw-research.json` 中配置 **`servers`**，作为未配置项目级覆盖时的默认值。
2. **按项目/方向覆盖**：若某项目目录下存在 **`{PROJ}/servers.json`**，则该项目的 SSH 部署**仅**使用该文件中的配置，不再使用全局 `servers`。这样不同 proj（不同方向）可绑定不同机器。

### 全局配置示例（~/.openclaw/openclaw-research.json）

```json
{
  "servers": {
    "default": "gateway",
    "list": ["gateway", "gpu-node-2", "gpu-node-3"]
  }
}
```

### 项目级覆盖示例（{PROJ}/servers.json）

在项目根目录下创建 `servers.json`，格式与全局一致：

```json
{
  "default": "gpu-lab-1",
  "list": ["gpu-lab-1", "gpu-lab-2"]
}
```

- **`default`**：该项目的默认 SSH host。
- **`list`**：该项目允许使用的 host 列表；技能只从该列表中选机。

**解析顺序**：执行 `/experiment-phase`、`/parallel-experiments` 等时，先读 **`{PROJ}/servers.json`**，若存在则用其 `default` 与 `list`；若不存在则使用全局 `~/.openclaw/openclaw-research.json` 的 `servers`。

### Agent 使用约定

- Researcher 在执行实验相关技能时，按上述顺序解析当前项目的 servers，从 `list` 中选择 host（可按负载、GPU 空闲等策略）。
- 每台 host 需已配置 SSH 免密、`nvidia-smi`、`screen`、`uv`（或等效环境）。

---

配置完成后，重启或新开会话使 OpenClaw 重新加载配置。修改 `projectsRoot` 后，需确保目标目录存在且各 agent 进程有读写权限。
