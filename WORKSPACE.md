# WORKSPACE.md — Directory Architecture

> This is the **canonical reference** for all file paths in the openclaw-research plugin.
> Every agent MUST read this file and follow its ownership rules.
> Rule summary: **write only to your own folder; read from any folder**.
> **项目目录独立于 agent workspace**，通过可配置的 `projectsRoot` 存放，所有 agent 均可访问。

---

## 路径解析约定

- **{PROJECTS_ROOT}**：项目根目录，**可配置**，与各 agent 的 workspace 分离。
  - 解析顺序：环境变量 `OPENCLAW_PROJECTS_ROOT` → 文件 `~/.openclaw/openclaw-research.json` 的 `projectsRoot` 键 → 默认 `~/.openclaw/projects`。
  - 在 `openclaw.json` 中通过顶层键 **`projectsRoot`** 配置（如 `"~/ResearchProjects"`），运行时或 install 会将其同步到 `~/.openclaw/openclaw-research.json` 供 agent 读取。
- **{PROJ}** = `{PROJECTS_ROOT}/{proj-id}` — 单个项目目录。
- **{WS}** = 当前 agent 的 workspace（如 `~/.openclaw/workspace-researcher`），仅存放身份、流程定义等，**不**存放项目数据。
- **{PMEM}** = `{PROJ}/memory` — **项目级记忆**（ideation、experiment、每日日志），位于项目根下，所有 agent 可读；写入权限见下表。

---

## Top-Level Structure

```
{PROJECTS_ROOT}/                     ← 可配置，例如 ~/.openclaw/projects 或 ~/ResearchProjects
│
├── PROJECTS_STATE.json              ← 多项目注册表（researcher 写，所有 agent 可读）
│
└── {proj-id}/                       ← 一个目录对应一个研究项目
    ├── README.md                    ← OWNED BY: researcher（项目概述）
    ├── WORKFLOW.md                  ← 本项目使用的 workflow 快照
    ├── servers.json                 ← 可选；本项目专用服务器配置，覆盖全局 servers（不同方向可不同）
    │
    ├── memory/                      ← 项目级记忆（所有 agent 可读；researcher 负责写入）
    │   ├── ideation-memory.md
    │   ├── experiment-memory.md
    │   └── YYYY-MM-DD.md            ← 按项目每日日志（append-only）
    │
    ├── researcher/                  ← OWNED BY: researcher
    ├── orchestrator/                ← OWNED BY: orchestrator
    ├── coder/                       ← OWNED BY: coder
    ├── analyzer/                    ← OWNED BY: analyzer
    ├── academic_writer/             ← OWNED BY: academic_writer
    ├── reviewer/                    ← OWNED BY: reviewer
    └── cross-reviewer/              ← OWNED BY: cross-reviewer
```

Agent 的 workspace（如 `~/.openclaw/workspace-researcher`）内仅保留：SOUL.md、AGENTS.md、WORKFLOW.md、BOOTSTRAP.md、HEARTBEAT.md 等身份与流程定义；**项目数据一律在 {PROJECTS_ROOT} 下**。

---

## Ownership Rules

| Agent | Owns (write) | Can read |
|-------|---------------|----------|
| **researcher** | `{PROJECTS_ROOT}/PROJECTS_STATE.json`, `{PROJ}/researcher/`, `{PROJ}/README.md`, `{PROJ}/memory/`, `{PROJ}/servers.json` | 全部 |
| **orchestrator** | `{PROJ}/orchestrator/` | 全部 under `{PROJ}/` |
| **coder** | `{PROJ}/coder/` | `{PROJ}/orchestrator/`, `{PROJ}/researcher/` |
| **analyzer** | `{PROJ}/analyzer/` | `{PROJ}/researcher/`, `{PROJ}/orchestrator/` |
| **academic_writer** | `{PROJ}/academic_writer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/`, `{PROJ}/reviewer/` |
| **reviewer** | `{PROJ}/reviewer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/` |
| **cross-reviewer** | `{PROJ}/cross-reviewer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/`, `{PROJ}/academic_writer/` |

> **Enforcement**: Each agent's `AGENTS.md` specifies these rules explicitly.
> Agents MUST NOT create files outside their owned directory.
> Agents CAN read from `{PROJ}/memory/` and any other agent's directory under `{PROJ}/`.

---

## Per-Project Directory Contents

### `{PROJ}/memory/` — 项目级记忆（所有 agent 可读）

```
memory/
├── ideation-memory.md       ← 选题记忆（有效模式 + 失败分类）
├── experiment-memory.md     ← 实验策略记忆（有效超参、数据处理技巧）
└── YYYY-MM-DD.md            ← 按项目每日日志（append-only）
```

### `{PROJ}/researcher/`

```
researcher/
├── LITERATURE.md
├── IDEA_REPORT.md
├── EXPERIMENT_LOG.md
├── EXPERIMENT_REGISTRY.md
├── IDEA_TOURNAMENT_STATE.json
├── REVIEW_STATE.json
├── PARALLEL_STATE.json
├── workflow_snapshots/
│   └── WORKFLOW.YYYY-MM-DD_HHMM.md
└── artifacts/
    ├── pilots/
    ├── results/
    └── logs/
```

### `{PROJ}/orchestrator/`

```
orchestrator/
├── PLAN.md
└── TODOS.md
```

### `{PROJ}/coder/` … `{PROJ}/cross-reviewer/`

与原有约定一致（见插件内各 agent 的 AGENTS.md）。

---

## Path Variables

| Variable | Resolves to |
|----------|-------------|
| `{PROJECTS_ROOT}` | 配置的项目根目录（env 或 ~/.openclaw/openclaw-research.json） |
| `{PROJ}` | `{PROJECTS_ROOT}/{proj-id}` |
| `{PMEM}` | `{PROJ}/memory` |
| `{WS}` | 当前 agent 的 workspace（如 ~/.openclaw/workspace-researcher） |

Example: `{PROJ}/researcher/IDEA_REPORT.md`，`{PMEM}/ideation-memory.md`

---

## 记忆隔离（按项目）

长期记忆全部在 **项目级** `{PROJ}/memory/` 下，不同 `{proj-id}` 天然隔离，多项目/多方向并行互不干扰。无需改 workspace 或 agent 配置。

---

## 多台服务器

实验阶段通过 SSH 部署到远程 GPU。全局默认 **`servers`** 放在 `~/.openclaw/openclaw-research.json`；**按项目/方向**可在项目下放 **`{PROJ}/servers.json`** 覆盖该项目的服务器列表，不同 proj 可使用不同服务器。详见 CONFIG.md。

---

## TODOS.md Convention (shared file)

`{PROJ}/orchestrator/TODOS.md` 的读写约定与原先一致（多 agent 协作更新）。

---

## Cross-Reviewer / Reviewer Output Convention

与原先一致：调用方将审稿结果写入 `{PROJ}/cross-reviewer/` 或 `{PROJ}/reviewer/`。
