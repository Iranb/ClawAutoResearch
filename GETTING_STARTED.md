## 第一次运行指南 — openclaw-research 插件

> 本文档介绍：插件安装完成后，如何启动第一次「自动化科研」运行。  
> **多科研方向并行**或**多台 GPU 服务器**配置见 [CONFIG.md](./CONFIG.md)。

---

## Install 后需要配置的内容

安装脚本**不会修改**你本机的 `openclaw.json`，只会在 `~/.openclaw/` 下创建 workspace、技能、`openclaw-research.json` 等，并输出修改建议到 `openclaw-research-suggested-changes.txt`。完成 install 后，按需完成下面配置即可运行。

| 配置项 | 是否必选 | 说明 |
|--------|----------|------|
| **OpenClaw 主配置** | **必选** | 确保 OpenClaw 使用的 `openclaw.json`（通常在 `~/.openclaw/openclaw.json` 或你指定的路径）里包含 researcher / orchestrator / coder / analyzer / academic_writer / reviewer / cross-reviewer 等 agent 定义，以及各 agent 的 `workspace`、`skills`、`subagents.allowAgents` 等。可直接参考插件内的 `openclaw.json`，或按 `openclaw-research-suggested-changes.txt` 中的建议**手动**编辑。 |
| **项目根目录 projectsRoot** | 可选 | 若希望项目不在默认 `~/.openclaw/projects` 下，在 openclaw.json 顶层增加 `projectsRoot: "你的路径"`（如 `"~/ResearchProjects"`）。安装脚本不会改 openclaw.json；若你已手动配置 projectsRoot，可同时把相同值写入 `~/.openclaw/openclaw-research.json` 的 `projectsRoot` 键，供 agent 解析。 |
| **运行模式（AUTO_PROCEED / PROJECT_MODE）** | 推荐 | 编辑 `~/.openclaw/workspace-researcher/WORKFLOW.md` 顶部：`AUTO_PROCEED: false`（每阶段等人）、`PROJECT_MODE: single`（单项目）。 |
| **GPU 服务器 servers** | 需要跑实验时必选 | **不在 openclaw.json 配置**。全局默认写在 `~/.openclaw/openclaw-research.json` 的 `servers`；或在该项目目录下放 `{PROJ}/servers.json` 覆盖（见 [CONFIG.md](./CONFIG.md)）。并确保 SSH 免密、`nvidia-smi`、`screen`、`uv` 等在该主机可用。 |
| **Researcher 服务器信息（SERVER.md）** | 需要跑实验时推荐 | 在 researcher 的 agent 目录或 workspace 下提供 `SERVER.md`（SSH 别名、远程目录、uv 路径等），供 `/experiment-phase` 使用。具体路径以你当前 OpenClaw/agent 布局为准。 |
| **项目目录** | 可选 | 首次跑 pipeline 前可先建项目目录，例如 `mkdir -p ~/.openclaw/projects/我的项目id`（若改了 projectsRoot 则在其下建）。不建也可，由 researcher 在运行时创建。 |

以上都配好后，在 OpenClaw 中启动 **researcher** 会话，即可执行 `/research-pipeline` 或分阶段技能。

---

### 1. 选择入口 Agent

- **推荐首次入口：`researcher`**
  - 单项目端到端：从选题 → 实验 → 分析 → 写论文。
  - 使用本地 `~/.openclaw/workspace-researcher` 及插件提供的 skills。
- **高级用法：`orchestrator`**
  - 适合 Discord 多人协作、多个项目并行时使用。
  - 先熟悉 `researcher` 单项目流程，再切换 orchestrator 做「PI」视角统筹。

在 OpenClaw 中，启动一个新的 **researcher 会话** 作为第一次尝试。

---

### 2. 配置运行模式（AUTO_PROCEED 与 Gate）

打开：

- `~/.openclaw/workspace-researcher/WORKFLOW.md`

检查顶部配置：

```text
AUTO_PROCEED: false        # true = 全自动，false = 每个 Gate 等你确认
GATE_TIMEOUT_HOURS: 24
PROJECT_MODE: single       # single | queue
```

**第一次推荐设置：**

- `AUTO_PROCEED: false`  —— 半自动模式，每个关键阶段会停下来等你决策。
- `PROJECT_MODE: single` —— 只跑一个项目，不开多项目队列。

修改后，**重启 researcher 会话**，让其重新读取最新的 `WORKFLOW.md`。

---

### 3. 准备一个项目目录（可选，但推荐）

在**项目根目录**（默认 `~/.openclaw/projects`，可在 openclaw.json 中通过 `projectsRoot` 指定）下新建项目目录，例如：

```bash
mkdir -p ~/.openclaw/projects/gcd_v1
```

第一次执行 `/research-pipeline` 时，researcher 会：

- 在 `{PROJECTS_ROOT}/<proj-id>/` 下创建分工子目录（含 `memory/`、`researcher/`、`orchestrator/` 等）：
  - `researcher/`、`orchestrator/`、`coder/`、`analyzer/`、`academic_writer/`、`reviewer/`、`cross-reviewer/`
- 按 `WORKSPACE.md` 和 `WORKFLOW.md` 规定的 ownership 写入文件。

你也可以不提前建目录，直接让 researcher 选择合适的 `proj-id` 并初始化。

---

### 4. 启动端到端流水线

在 **researcher 会话** 中输入一条指令，附上你想做的研究问题描述，例如：

```text
/research-pipeline "在 ImageNet 上做 Generalized Category Discovery 的自动化实验流水线（baseline + 新方法）"
```

内部会按插件定义的阶段自动推进：

1. **IDEA 阶段**
   - 调用 `/idea-phase`、`/idea-generator`、`/novelty-check`、`/idea-tournament`
   - 输出：`{PROJ}/researcher/IDEA_REPORT.md`、`LITERATURE.md`
   - 在 **GATE-1** 停下来向你汇报候选 idea 与新颖性评估。

2. **PLAN 阶段**
   - spawn `orchestrator`（原 planner）执行 `/plan-research`
   - 输出：`{PROJ}/orchestrator/PLAN.md`、`{PROJ}/orchestrator/TODOS.md`
   - 在 **GATE-2** 停下来让你确认实验设计与算力预算。

3. **CODE 阶段**
   - spawn `coder` 执行 `/implement-experiment`
   - 输出：`{PROJ}/coder/<experiment-name>/` 代码与 `README.md`

4. **EXPERIMENT 阶段**
   - researcher 运行 `/experiment-phase`（内部使用 `uv` + 清华源、SSH 到远程 GPU）
   - 输出：`{PROJ}/researcher/artifacts/results/`、`EXPERIMENT_REGISTRY.md`
   - 在 **GATE-3** 停下来展示关键指标与相对 baseline 的提升。

5. **ANALYZE 阶段**
   - spawn `analyzer` 调用 `/analyze-results`（+ `scientific-figures`）
   - 输出：`{PROJ}/analyzer/NARRATIVE_REPORT.md`、`figures/`、`tables/`

6. **REVIEW（内部审稿）阶段**
   - spawn `reviewer` 执行 `/review-phase` + `/evidence-grading`
   - 输出：`{PROJ}/reviewer/REVIEW_REPORT.md`、`REVIEW_STATE.json`

7. **WRITE 阶段**
   - spawn `academic_writer` 执行 `/paper-plan`、`/paper-write`、`/paper-compile`
   - 调用 `cross-reviewer` 做大纲与段落级审稿
   - 输出：`{PROJ}/academic_writer/PAPER_PLAN.md`、`paper/sections/`、`paper/main.pdf`
   - 在 **GATE-4** 停下来让你确认论文稿是否进入外部审稿。

8. **SUBMIT / 外部 AI 审稿**
   - 在 reviewer 会话中运行 `/paperreview-submit`
   - 输出：外部 AI 审稿意见与初稿 rebuttal
   - 在 **GATE-5（必停 Gate）** 由你决定是否大修 / 小修 / 接受。

因为 `AUTO_PROCEED=false`，每个 Gate（GATE-1 ~ GATE-4 + GATE-5）都会：

- 打印结构化总结（当前阶段做了什么、关键指标、文件路径）
- 提供可选指令（继续 / 修改 / 停止 / 回到前一阶段）
- 等待你的自然语言指示后再继续。

---

### 5. 分阶段手动驾驶（更精细的控制）

如果你暂时不想一次跑完，可以只调用某些阶段的技能，例如：

- 只想做选题与文献：
  - `/idea-phase`
  - `/research-lit`
  - `/novelty-check`
- 只想调度并行实验：
  - `/experiment-phase`
  - `/parallel-experiments`
- 只想写论文：
  - 在已有 `NARRATIVE_REPORT.md` 和 `figures/` 的前提下，让 `academic_writer` 执行：
    - `/paper-plan`
    - `/paper-write`
    - `/paper-compile`

你可以在任何阶段插话，例如：

```text
这次先只做到 PLAN 阶段，不要启动任何远程实验。
```

或者：

```text
在 PLAN 里强制加入一个 reproduce baseline 的 stage，再继续。
```

researcher / orchestrator 会把这些要求写回 `PLAN.md` 和 `TODOS.md` 后再推进。

---

### 6. 建议的首轮「练手」流程

1. **启动 researcher 会话**，确认开场自检输出中包含：
   - 当前 `AUTO_PROCEED` 模式
   - 是否检测到已有项目 / `TODOS.md`
2. **只跑 IDEA 阶段**：
   - 执行 `/idea-phase`，检查 `{PROJ}/researcher/IDEA_REPORT.md` 与 `LITERATURE.md` 是否符合你预期的选题与综述风格。
3. **跑一次完整 `/research-pipeline`**：
   - 选择一个你已经熟悉的小问题作为项目（便于你判断合理性）。
   - 在每个 Gate 仔细查看总结和生成的文件。
4. **根据体验调整**：
   - 在 `WORKFLOW.md` 调整哪些 Gate 必须等待你、哪些可以在 `AUTO_PROCEED=true` 时自动跳过。
   - 在 `WORKSPACE.md` 扩展或收紧各 agent 的读写权限。
   - 针对你的 GPU 集群和实验习惯，微调 `experiment-phase` 与 `parallel-experiments` 的默认参数。

完成以上步骤后，你就有了一个可控的「自动化科研流水线」，可以选择：

- 白天用 Gate 模式（`AUTO_PROCEED=false`）和它协作；
- 晚上改成 `AUTO_PROCEED=true`，把一个项目交给它「通宵跑」，第二天回来查看结果与生成的报告/论文草稿。




