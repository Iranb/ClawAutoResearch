# openclaw-research

OpenClaw plugin for automated research with PaperNexus grounding, deterministic workflow control, structured experiment memory, and multi-agent paper writing.

一个面向自动化科研的 OpenClaw 插件，提供基于 PaperNexus 的图谱 grounding、确定性的 workflow 自动迭代、结构化实验记忆，以及多 Agent 论文写作流程。

## What This Repo Is | 这个仓库是什么

`openclaw-research` 把科研流程从“靠聊天上下文维持的 prompt 链”升级成“靠状态文件、插件动作和运行时约束驱动的可恢复状态机”。

Current flagship capabilities:

当前最核心的能力包括：

- deterministic `research_workflow.auto_iterator_tick`
- 确定性的 `research_workflow.auto_iterator_tick`
- runtime workflow guard for file boundaries, communication, and stage order
- 运行时 workflow guard，用于约束文件写入、内部通信和阶段顺序
- PaperNexus-first, Markdown-first literature ingestion and graph grounding
- PaperNexus-first、Markdown-first 的文献摄取与图谱 grounding
- experiment ledger, innovation reflection freshness, and idle research
- 实验账本、创新反思新鲜度约束，以及 idle research
- agent-to-agent dispatch with mailbox durability
- 结合 mailbox 持久化的 agent-to-agent 任务下发
- template-driven writing with paragraph-logic and citation-integrity checks
- 基于模板、段落逻辑和引用完整性的写作约束

## Read This First | 建议先看这些

- [DOC/README.md](./DOC/README.md)
  Unified documentation portal and task-based navigation.
  统一文档入口，按任务场景导航。
- [DOC/guides/getting-started.md](./DOC/guides/getting-started.md)
  Fastest path from fresh install to first automated research project.
  从安装到启动第一个科研项目的最快路径。
- [WORKFLOW.md](./WORKFLOW.md)
  Full workflow contract, stage gates, and behavior policy.
  完整 workflow 契约、阶段 gate 和行为政策。
- [WORKSPACE.md](./WORKSPACE.md)
  Canonical directory layout and write-ownership rules.
  权威目录布局和写入归属规则。
- [CONFIG.md](./CONFIG.md)
  Path and config cheat sheet.
  路径与关键配置速查。

## How The System Is Organized | 系统是怎么组成的

| Layer | Responsibility | 说明 |
| --- | --- | --- |
| Agents | Role identity and lifecycle files | `agents/<role>/` 下的 `AGENTS.md`、`SOUL.md`、`BOOTSTRAP.md` 等 |
| Skills | Step-by-step operating contracts | 各角色技能，负责把任务拆成可执行流程 |
| Plugin | Runtime hooks and structured tools | `index.ts`、`research_workflow`、`research_memory` |
| State | Durable project truth | `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`EXPERIMENT_LEDGER.json` 等 |
| External knowledge | Literature retrieval and graph grounding | `papers-cool`、`pasa-paper-search`、`hugging-face-paper-pages`、`arxiv2md`、PaperNexus |

## Quick Start | 快速开始

1. Build and install the plugin.
1. 先构建并安装插件。

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
bash install.sh --dry-run
bash install.sh
```

2. Merge the recommended plugin settings into your real OpenClaw config.
2. 把推荐配置合并到你实际使用的 OpenClaw 配置里。

Minimum required items:

最少要确认这些：

- load `~/.openclaw/plugins`
- 启用 `~/.openclaw/plugins`
- enable `openclaw-research`
- 启用 `openclaw-research`
- set `plugins.entries.openclaw-research.config.projectsRoot`
- 配置 `plugins.entries.openclaw-research.config.projectsRoot`
- allow `research_workflow` for the working roles
- 给工作角色放行 `research_workflow`
- keep `heartbeat.every = "30m"` for the default `researcher`
- 默认 `researcher` 保持 `heartbeat.every = "30m"`

Reference files:

参考文件：

- [openclaw.RECOMMENDED.json](./openclaw.RECOMMENDED.json)
- [DOC/reference/configuration.md](./DOC/reference/configuration.md)

3. Start a new project from `researcher`.
3. 用 `researcher` 启动新项目。

```text
/research-pipeline "your research topic" -- AUTO_PROCEED: true
```

4. If you are working from Discord, bind the current channel to the created project.
4. 如果你是在 Discord 里工作，把当前频道绑定到新项目。

```json
{
  "action": "bind_channel_project",
  "channelBinding": {
    "projectRoot": "/absolute/path/to/the-created-project"
  }
}
```

5. Let the system continue through heartbeat and recovery turns.
5. 后续让 heartbeat 和恢复轮次继续驱动自动迭代。

## Research Workflow At A Glance | 科研主流程一览

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`

Important operational notes:

重要运行约束：

- `graph_build` / `frontier_mapping` / `idea` now include a real graph-presence check
- `graph_build` / `frontier_mapping` / `idea` 现在都带真实的图谱论文存在性检查
- `papers-cool` is the guaranteed search baseline, and `pasa-paper-search` can be merged in as an optional second retrieval source
- `papers-cool` 是稳定保底的检索入口，`pasa-paper-search` 则作为可选的第二检索源并入结果
- once a paper identity is confirmed, the preferred path is Hugging Face Markdown first, then arxiv2md, and PDF only as the last fallback
- 一旦确认到具体论文身份，默认先拉 Hugging Face Markdown，再尝试 arxiv2md，PDF 只作为最后 fallback
- new experiment evidence can make innovation reflection stale and block serious ideation until refreshed
- 新实验结果会让创新反思过期，并在刷新前阻止严肃 ideation
- writer can be constrained by `writing_contract`
- Writer 可以通过 `writing_contract` 受模版和逻辑约束
- submission still keeps a mandatory human gate
- 投稿阶段仍保留强制人工 gate

## Core Runtime Capabilities | 关键运行能力

- **Auto iterator**
  Reconciles stage state, performs hard regressions when prerequisites are missing, and queues or dispatches the next owner task.
- **自动迭代器**
  对齐阶段状态，在前置条件缺失时硬性回退，并为下一个 owner 派发任务。

- **Workflow guard**
  Injects context before each turn and blocks unsafe writes, unsafe spawns, unsafe messages, and stage-breaking actions.
- **Workflow guard**
  每轮前注入上下文，并拦截越界写文件、非法 spawn、非法消息和破坏阶段顺序的动作。

- **PaperNexus-backed literature loop**
  `papers-cool search (+ optional pasa-paper-search merge) -> confirmed identity -> hugging-face-paper-pages Markdown -> arxiv2md Markdown fallback -> PDF fallback -> graph refresh -> PaperNexus reasoning`
- **PaperNexus 驱动的文献回路**
  `papers-cool 检索（可选合并 pasa-paper-search） -> 确认论文身份 -> hugging-face-paper-pages Markdown -> arxiv2md Markdown fallback -> PDF fallback -> 刷图 -> PaperNexus 推理`

- **Structured experiment memory**
  `researcher/EXPERIMENT_LEDGER.json` is the durable experiment source of truth.
- **结构化实验记忆**
  `researcher/EXPERIMENT_LEDGER.json` 是实验事实的持久化权威来源。

- **Agent communication controls**
  Raw mentions are sanitized, cooldown is enforced, mailbox is durable, and agent-to-agent dispatch can actively wake the target role.
- **Agent 通信约束**
  原始 mention 会被清洗，通信有 cooldown，mailbox 可持久化，agent-to-agent 派发还能主动唤醒目标角色。

- **Channel-to-project isolation**
  Optional Discord/session binding allows different channels to drive different projects in one OpenClaw process.
- **频道到项目隔离**
  可选的 Discord/session 绑定能力让同一进程里的不同频道稳定对应不同科研项目。

## Repository Map | 仓库入口说明

- [index.ts](./index.ts)
  Plugin entry, tool registration, and runtime hook wiring.
  插件入口、工具注册和运行时 hook 接线。
- [tools/workflow-guard.ts](./tools/workflow-guard.ts)
  Main workflow policy engine.
  主要 workflow 策略引擎。
- [tools/graph-presence.ts](./tools/graph-presence.ts)
  Real graph-presence checking against the canonical paper set.
  针对 canonical 论文集合的真实图存在性检查。
- [WORKFLOW.md](./WORKFLOW.md)
  Human-readable workflow contract.
  面向人的 workflow 总规范。
- [DOC/README.md](./DOC/README.md)
  Documentation hub.
  文档总入口。

## Documentation Roles | 文档分工

- `README.md`
  Landing page for humans opening the repo for the first time.
  仓库首页，只负责说明“这是什么、怎么开始、该去哪继续看”。
- `DOC/README.md`
  Documentation hub and reading map.
  文档门户和阅读地图。
- `WORKFLOW.md`
  Behavioral contract and stage policy.
  行为契约和阶段政策。
- `WORKSPACE.md`
  File layout and ownership rules.
  文件布局和归属规则。
- `CONFIG.md`
  Path and config cheat sheet.
  路径和配置速查。

## Development | 开发与验证

```bash
npm test
npm run build
```

The repository-level smoke checks should stay green before install or deployment.

安装或部署前，仓库级 smoke check 应保持通过。
