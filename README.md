# openclaw-research

OpenClaw plugin for automated research with PaperNexus grounding, deterministic workflow control, experiment memory, and multi-agent paper writing.

一个面向自动化科研的 OpenClaw 插件，提供基于 PaperNexus 的图谱推理、确定性的 workflow 自动迭代、实验记忆、以及多 Agent 论文写作流程。

## Overview | 概览

`openclaw-research` turns the research loop into a durable state machine instead of a chat-only prompt flow.

`openclaw-research` 的目标，是把科研流程从“靠聊天上下文维持”的提示词链路，升级成“靠文件状态驱动”的可恢复状态机。

The current codebase focuses on:

当前版本重点解决：

- deterministic workflow progression through the `research_workflow` plugin tool and the new auto iterator
- 通过 `research_workflow` 插件工具和新的 auto iterator，实现确定性的流程推进
- PaperNexus-first, Markdown-first literature grounding before ideation, novelty checks, and reflection
- 在 idea、novelty、reflection 之前，优先使用 PaperNexus 做 Markdown-first 的文献图谱 grounding
- file-backed project state for recovery, multi-project execution, and reduced context drift
- 用文件持久化项目状态，支持恢复、多项目并行、以及降低上下文漂移
- experiment memory and experiment-informed innovation reflection
- 实验记忆，以及“实验后反思再提创新点”的约束
- template-driven academic writing with paragraph-logic constraints
- 按模板写作，并约束段落之间的逻辑关联
- safer multi-agent communication in Discord and internal workflow channels
- 在 Discord 和内部协作路径上更安全、更受控的多 Agent 通信

## What Is New In The Latest Code | 当前代码新增能力

- **Deterministic auto iterator**
  `research_workflow` now exposes `auto_iterator_tick`, which reconciles stage state, regresses invalid stage jumps, advances when completion signals exist, updates `PROJECT_MANIFEST.json`, synchronizes `PROJECTS_STATE.json`, and records an audit under `.openclaw-research/auto-iterator-state.json`.
- **确定性自动迭代器**
  `research_workflow` 现在提供 `auto_iterator_tick`，会自动核对阶段状态、必要时回退错误阶段、在 completion signal 齐全时推进到下一阶段、同步 `PROJECT_MANIFEST.json` 和 `PROJECTS_STATE.json`，并把审计结果写到 `.openclaw-research/auto-iterator-state.json`。

- **Workflow guard at runtime**
  Hooks inject workflow context before each turn and block unsafe writes, unsafe spawns, workflow-breaking messages, and out-of-scope edits before they happen.
- **运行时 workflow guard**
  插件 hook 会在每轮前注入 workflow snapshot，并在真正调用工具之前拦截越界写文件、非法 spawn、非法内部消息、以及破坏流程的操作。

- **Idle research as bounded background work**
  `idle_research` is persisted in `PROJECT_MANIFEST.json`, and Researcher can keep surveying a configured topic while the critical path is blocked.
- **空闲调研成为受控后台任务**
  `idle_research` 被持久化在 `PROJECT_MANIFEST.json` 中，Researcher 在主流程等待期间可以持续追踪指定主题，而不是随机漂移。

- **Experiment ledger and reflection freshness**
  `researcher/EXPERIMENT_LEDGER.json` is now the authoritative experiment memory, and new experiment evidence can mark innovation reflection as stale until it is refreshed.
- **实验账本与反思新鲜度**
  `researcher/EXPERIMENT_LEDGER.json` 现在是权威实验记忆源；一旦新的实验结果进入账本，创新反思会被自动标为待刷新，直到重新反思。

- **Structured coder experiment folders**
  Coder now treats each experiment as a structured bundle with a bundle manifest and a project-level `coder/EXPERIMENT_INDEX.md`, so later launches and analyses can still recover which track, question, and result directory each folder belongs to.
- **结构化实验文件夹约束**
  现在要求 Coder 把每个实验组织成结构化 bundle，并维护项目级 `coder/EXPERIMENT_INDEX.md`；这样后续回看大量实验目录时，仍然能恢复“这个文件夹属于哪条 track、回答什么问题、结果在哪”。

- **Template-driven writing contract**
  Writer reads `writing_contract` from `PROJECT_MANIFEST.json`, follows the user template, and respects paragraph-logic constraints before final prose.
- **模板驱动的写作契约**
  Writer 会读取 `PROJECT_MANIFEST.json.writing_contract`，按用户模板写作，并在最终成文前遵守段落逻辑检查。

- **Mode-aware paper writing + citation integrity**
  The workflow now supports built-in `conference` (`9` body pages + `2` reference pages) and `journal` (`12` body pages + `2` reference pages) modes, plus a durable citation-integrity state that blocks submission until bibliography verification is complete.
- **模式化论文写作 + 引用完整性**
  现在 workflow 内置 `conference`（正文 `9` 页 + 参考文献 `2` 页）和 `journal`（正文 `12` 页 + 参考文献 `2` 页）两种模式，同时引入持久化的 citation integrity 状态；在参考文献验证完成之前，submission 不会通过。

- **Safer agent communication**
  Raw `@agent` mentions are sanitized, source-to-target contact cooldown is enforced, and workflow mailbox is available for structured internal handoff.
- **更安全的 Agent 通信**
  原始 `@agent` mention 会被清洗，同一 source 到同一 target 的重复唤醒会受到 cooldown 限制，同时支持 workflow mailbox 进行结构化内部交接。

- **Optional Discord/channel-to-project binding**
  When enabled, a Discord channel/session can be bound to a specific project root, so different channels in the same OpenClaw process can drive different research projects without sharing one global `OPENCLAW_PROJECT`.
- **可选的 Discord / channel -> project 绑定**
  开启后，可以把某个 Discord 频道或 session 绑定到一个固定项目目录。这样同一个 OpenClaw 进程里的不同频道，就能稳定运行不同科研项目，而不是都依赖同一个全局 `OPENCLAW_PROJECT`。

## Workflow Stages | 科研流程阶段

The workflow is modeled as:

当前 workflow 建模为：

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`

There is also a `revise` loop that can route the project back to `write` or `experiment`.

此外还存在 `revise` 回路，可以把项目重新送回 `write` 或 `experiment`。

Important note:

重要说明：

- the pipeline can auto-iterate across most stages
- 多数阶段可以自动推进
- stage order is still strict and completion signals are mandatory
- 阶段顺序仍然是硬约束，completion signal 仍然必须满足
- `GATE-5` at the submission/revision decision remains a mandatory human checkpoint
- `submit` 之后的 `GATE-5` 修回决策，仍然是必须人工参与的 checkpoint

## Main Agents | 主要 Agent

| Agent | Role | 说明 |
| --- | --- | --- |
| `researcher` | Orchestrator and state steward | 总控 Agent，负责阶段推进、状态恢复、文献与实验记忆、PaperNexus 调用 |
| `orchestrator` | Planning | 根据 idea 生成 `PLAN.md`、`TODOS.md`、`PLAN_AUDIT.md` |
| `coder` | Implementation and experiment execution | 负责实现、远程实验部署、运行脚本和复现实验 |
| `analyzer` | Evidence analysis | 负责结果分析、claim-evidence 对齐、质量审查 |
| `academic_writer` | Paper writing | 负责 outline、模板映射、段落逻辑、论文撰写 |
| `reviewer` | Independent reviewer | 负责独立审查、review packet、submission/revision 材料 |
| `cross-reviewer` | Read-only external-style reviewer | 只读 reviewer，用于更独立的交叉审查 |

Each role now has a fuller OpenClaw-style agent bundle under `agents/<role>/`, including `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `BOOT.md`, `BOOTSTRAP.md`, and `HEARTBEAT.md`.

每个角色现在都拥有更完整的 OpenClaw 风格配置，位于 `agents/<role>/` 下，包括 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`TOOLS.md`、`BOOT.md`、`BOOTSTRAP.md`、`HEARTBEAT.md`。

## State Files | 核心状态文件

- `PROJECT_MANIFEST.json`
  Project-wide state: stage, micro-stage, owner, next action, idle research, innovation reflection, writing contract, paper ingestion, and experiment memory summary.
- `PROJECT_MANIFEST.json`
  项目级主状态文件：阶段、微阶段、owner、next action、idle research、innovation reflection、writing contract、paper ingestion、experiment memory 摘要。

- `TRACK_REGISTRY.json`
  Candidate, active, parked, and killed tracks.
- `TRACK_REGISTRY.json`
  候选、活跃、暂停、终止的 research tracks。

- `CLAIM_POLICY.md`
  Claim promotion policy from analysis to writing.
- `CLAIM_POLICY.md`
  claim 从分析阶段进入写作阶段的约束政策。

- `researcher/EXPERIMENT_LEDGER.json`
  The authoritative experiment ledger.
- `researcher/EXPERIMENT_LEDGER.json`
  权威实验账本。

- `researcher/GATE_STATE.json`
  Gate state for resuming and human checkpoints.
- `researcher/GATE_STATE.json`
  gate 恢复与人工检查点状态。

- `PROJECTS_STATE.json`
  Registry for parallel projects and queue-style execution.
- `PROJECTS_STATE.json`
  并行项目与 queue 模式下的总状态表。

## PaperNexus And Literature Flow | PaperNexus 与文献流

The preferred ingestion path is:

推荐的文献引入链路是：

`papers-cool search -> once a paper identity is confirmed, hugging-face-paper-pages Markdown -> PDF fallback only if Markdown is unavailable -> PAPER_SOURCE_INDEX / graph refresh -> PaperNexus`

This means the pipeline should not wait for a later manual filtering step once it already knows which paper it is dealing with. If a result already exposes an arXiv ID, papers.cool paper page, arXiv URL, or Hugging Face paper URL, it should immediately try `hugging-face-paper-pages` and treat PDF as fallback only.

这意味着，一旦检索结果已经确认到具体论文身份，就不应该等到后续再手动决定是否拉全文。只要结果里已经有 arXiv ID、papers.cool 论文页、arXiv URL 或 Hugging Face 论文页，就应立即优先调用 `hugging-face-paper-pages`；PDF 仅在拿不到 Markdown 时作为 fallback。

This is used to support:

这条链路主要支撑：

- graph-grounded brainstorming
- 基于图谱的头脑风暴
- novelty and prior-work comparison
- novelty 与相关工作对比
- experiment-informed reflection
- 基于实验结果的反思
- idle topic tracking while the project is waiting
- 项目等待期间的后台主题调研

## Plugin Tool Surface | 插件工具接口

The main plugin tool is `research_workflow`.

主插件工具是 `research_workflow`。

Key actions:

关键动作包括：

- `get_snapshot`
- `check_graph_presence`
- `auto_iterator_tick`
- `get_idle_research`
- `set_idle_research`
- `record_idle_research_run`
- `get_experiment_memory`
- `upsert_experiment`
- `get_innovation_reflection`
- `record_innovation_reflection`
- `get_writing_contract`
- `set_writing_contract`
- `get_channel_project_binding`
- `bind_channel_project`
- `unbind_channel_project`
- `list_channel_project_bindings`
- `read_mailbox`
- `send_mailbox`
- `ack_mailbox`

`check_graph_presence` now performs a real PaperNexus corpus check against the project's canonical paper set before novelty-sensitive work. `auto_iterator_tick` calls the same check automatically during `graph_build`, `frontier_mapping`, and `idea`, and will regress the project back to `graph_build` when expected papers are still missing from the graph.

`check_graph_presence` 现在会在 novelty-sensitive 阶段前，基于项目的 canonical paper 集合真实检查 PaperNexus corpus 中是否已经有对应论文。`auto_iterator_tick` 在 `graph_build`、`frontier_mapping` 和 `idea` 阶段也会自动执行同样的检查；如果图里还缺论文，就会把项目硬性回退到 `graph_build`。

Typical auto-iterator call:

典型的自动迭代器调用：

```json
{
  "action": "auto_iterator_tick",
  "iterator": {
    "mode": "heartbeat"
  }
}
```

Typical writing contract call:

典型的写作契约调用：

```json
{
  "action": "set_writing_contract",
  "writingContract": {
    "paper_mode": "conference",
    "kg_storyline_required": true
  }
}
```

Typical citation verification record call:

典型的引用验证记录调用：

```json
{
  "action": "record_citation_verification",
  "citationVerification": {
    "verification_status": "verified",
    "verification_report_path": "reviewer/CITATION_VERIFICATION.md",
    "bibliography_path": "academic_writer/paper/refs.bib",
    "verified_citation_count": 24,
    "suspicious_citation_count": 0,
    "hallucinated_citation_count": 0,
    "unresolved_placeholder_count": 0
  }
}
```

Typical channel-project binding call:

典型的频道项目绑定调用：

```json
{
  "action": "bind_channel_project",
  "channelBinding": {
    "projectRoot": "/absolute/path/to/projects/my-project",
    "notes": "Bind this Discord research channel to my-project"
  }
}
```

## Installation | 安装

### 1. Prerequisites | 前置条件

- OpenClaw CLI is installed and available as `openclaw`
- 已安装 OpenClaw CLI，并且命令行为 `openclaw`
- passwordless SSH is available if you want remote GPU execution
- 如果要远程跑 GPU 实验，需要提前配置免密 SSH
- PaperNexus is available locally, usually as a sibling repository or through `PAPERNEXUS_ROOT`
- 本地可访问 PaperNexus，通常作为同级仓库存在，或通过 `PAPERNEXUS_ROOT` 指定

### 2. Preview installation | 先预览安装

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
bash install.sh --dry-run
```

If you want to overwrite workspace-root role files:

如果你想覆盖 workspace root 里的角色文件：

```bash
bash install.sh --dry-run --force-role-files
```

### 3. Install | 正式安装

```bash
bash install.sh
```

Or:

或者：

```bash
bash install.sh --force-role-files
```

### 4. Review installation output | 查看安装输出

After install, review:

安装完成后，重点检查：

- `openclaw-research/openclaw.RECOMMENDED.json`
- `openclaw-research/README.md`
- `openclaw-research/DOC/README.md`

## How To Update `openclaw.json` For The Latest Code | 新代码如何修改 `openclaw.json`

`install.sh` will not overwrite your own `~/.openclaw/openclaw.json`.

`install.sh` 不会直接改你的 `~/.openclaw/openclaw.json`，所以最新代码要生效，还需要你把下面这些改动合并进去。

### 1. Load the plugin and enable workflow guard | 加载插件并启用 workflow guard

At minimum, your config should load the installed plugin path and enable the `openclaw-research` entry.

至少要让 OpenClaw 能加载安装后的插件目录，并启用 `openclaw-research` 条目：

```js
plugins: {
  enabled: true,
  load: {
    paths: ["~/.openclaw/plugins"]
  },
  entries: {
    "openclaw-research": {
      enabled: true,
      config: {
        allowWorkspaceFallback: false,
        requireProjectIsolation: true,
        requireProjectIdInEntries: true,
        requireTrackId: true,
        requireEvidencePointers: true,
        reviewStateMaxAgeHours: 24,
        injectWorkflowContext: true,
        enforceWorkflowBoundaries: true,
        blockDiscordAgentMentions: true,
        enableWorkflowMailbox: true,
        heartbeatBackgroundChecks: true,
        maxWorkflowInboxMessages: 6,
        agentContactCooldownSeconds: 300,
        enableChannelProjectBindings: true
      }
    }
  }
}
```

By default, channel-project bindings now live under the resolved project at `{PROJ}/.openclaw-research/channel-project-bindings.json`. If `reviewer` / `cross-reviewer` use different workspaces from `researcher` and you still want one shared binding store, set an explicit `channelProjectBindingsPath`.

现在默认的 channel-project binding 文件会落在解析出的项目目录下：`{PROJ}/.openclaw-research/channel-project-bindings.json`。如果 `reviewer` / `cross-reviewer` 和 `researcher` 不共享同一个 workspace，但你又希望它们共用同一份绑定文件，再显式设置统一的 `channelProjectBindingsPath`。

### 2. Point `agentDir` and role skills to the plugin path | 把 `agentDir` 和角色 skills 指向插件目录

Do not keep `./agents/...` or `./skills/...` in your user config after installation.

安装后，不要在你自己的用户配置里继续保留 `./agents/...` 或 `./skills/...` 这种相对路径，而是要改成插件的绝对路径：

```js
const PLUGIN = "~/.openclaw/plugins/openclaw-research";

{
  id: "researcher",
  default: true,
  workspace: "~/.openclaw/workspace-researcher",
  agentDir: `${PLUGIN}/agents/researcher`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/researcher`]
}

{
  id: "orchestrator",
  workspace: "~/.openclaw/workspace-researcher",
  agentDir: `${PLUGIN}/agents/orchestrator`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/orchestrator`]
}

{
  id: "coder",
  workspace: "~/.openclaw/workspace-researcher",
  agentDir: `${PLUGIN}/agents/coder`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/coder`]
}

{
  id: "analyzer",
  workspace: "~/.openclaw/workspace-researcher",
  agentDir: `${PLUGIN}/agents/analyzer`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/analyzer`]
}

{
  id: "academic_writer",
  workspace: "~/.openclaw/workspace-researcher",
  agentDir: `${PLUGIN}/agents/academic_writer`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/academic_writer`]
}

{
  id: "reviewer",
  workspace: "~/.openclaw/workspace-reviewer",
  agentDir: `${PLUGIN}/agents/reviewer`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/reviewer`]
}

{
  id: "cross-reviewer",
  workspace: "~/.openclaw/workspace-cross-reviewer",
  agentDir: `${PLUGIN}/agents/cross-reviewer`,
  skills: ["~/.openclaw/skills", `${PLUGIN}/skills/cross-reviewer`]
}
```

### 3. Allow the new plugin tools | 放行新的插件工具

The latest code depends on both `research_memory` and `research_workflow`.

最新代码同时依赖 `research_memory` 和 `research_workflow`，所以各角色工具权限至少要这样合并：

```js
// researcher
tools: {
  allow: ["*"],
  deny: []
}

// orchestrator
tools: {
  allow: ["read", "write", "edit", "research_memory", "research_workflow"],
  deny: ["bash", "exec", "process"]
}

// coder
tools: {
  allow: ["read", "write", "edit", "bash", "research_memory", "research_workflow"],
  deny: []
}

// analyzer
tools: {
  allow: ["read", "write", "edit", "bash", "research_memory", "research_workflow"],
  deny: []
}

// academic_writer
tools: {
  allow: ["read", "write", "edit", "web_search", "web_fetch", "research_memory", "research_workflow"],
  deny: ["bash", "exec", "process"]
}

// reviewer
tools: {
  allow: ["read", "write", "edit", "bash", "memory_search", "memory_get", "web_search", "web_fetch", "research_memory", "research_workflow"],
  deny: ["exec", "process"]
}

// cross-reviewer
tools: {
  allow: ["read", "web_search", "web_fetch"],
  deny: ["write", "edit", "bash", "exec", "process"]
}
```

### 4. Keep heartbeat and shared state in sync | 同步 heartbeat 和共享状态

The current recommended heartbeat for the default `researcher` session is now `30m`, not `15m`.

当前推荐的默认 `researcher` heartbeat 已经改成 `30m`，不是 `15m`：

```js
agents: {
  defaults: {
    heartbeat: {
      every: "30m"
    },
    compaction: {
      memoryFlush: {
        enabled: true,
        softThresholdTokens: 4000
      }
    }
  }
}
```

If you want to set the project root, put it under the plugin entry instead of the top level:

如果你要设置项目根目录，请把它写在插件配置里，而不是顶层字段：

```js
plugins: {
  entries: {
    "openclaw-research": {
      enabled: true,
      config: {
        projectsRoot: "~/.openclaw/projects"
      }
    }
  }
}
```

### 5. Minimal merge checklist | 最小合并清单

If you already have your own custom models, prompts, or extra tools, keep them. The minimum you must merge from the latest code is:

如果你已经有自己的模型配置、prompt 或额外工具，可以保留；最新代码至少要合并这些关键点：

- plugin load path points to `~/.openclaw/plugins`
- enable the `openclaw-research` plugin entry
- keep workflow guard options enabled
- switch all `agentDir` and role `skills` to plugin absolute paths
- allow `research_workflow` for `orchestrator / coder / analyzer / academic_writer / reviewer`
- allow `research_memory` for agents that write structured research state
- keep `heartbeat.every = "30m"` for the default `researcher`

### 6. Easiest source of truth | 最省事的参考来源

If you do not want to merge by hand, inspect these files first:

如果你不想手工对照着改，最方便的参考来源是这几个现成文件：

- `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/openclaw.RECOMMENDED.json`
- `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/README.md`
- `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/DOC/README.md`

## Quick Start | 快速开始

1. Configure your OpenClaw instance to load the plugin from `~/.openclaw/plugins/openclaw-research`.
1. 在你的 OpenClaw 配置中启用 `~/.openclaw/plugins/openclaw-research` 插件。

2. Confirm that each agent uses the plugin agent directory and role skill roots.
2. 确认每个 agent 都指向插件内的 `agentDir`，并启用了对应角色 skill 根目录。

3. Edit `agents/researcher/SERVER.md` if you use remote GPU servers.
3. 如果你使用远程 GPU 服务器，请先编辑 `agents/researcher/SERVER.md`。

4. Launch a project:
4. 启动一个科研项目：

```text
/research-pipeline "your research topic" -- AUTO_PROCEED: true
```

5. Let heartbeat and recovery turns call `research_workflow.auto_iterator_tick` first.
5. 让 heartbeat 和恢复场景优先调用 `research_workflow.auto_iterator_tick`。

6. Use `idle_research` for bounded background topic tracking and `writing_contract` for template-based writing.
6. 用 `idle_research` 做后台主题调研，用 `writing_contract` 驱动模板写作。

## Development And Testing | 开发与测试

Run tests:

运行测试：

```bash
npm test
```

Build the plugin:

构建插件：

```bash
npm run build
```

The current test suite includes deterministic auto-iterator coverage for:

当前测试已经覆盖 auto iterator 的这些关键行为：

- staying in `setup` when required setup signals are missing
- 缺少 setup 信号时保持在 `setup`
- advancing from `setup` to `graph_build` when setup signals are complete
- setup 信号齐全时从 `setup` 自动推进到 `graph_build`
- stopping at the mandatory human gate in `submit`
- 在 `submit` 阶段正确卡在强制人工 gate

## Repository Pointers | 仓库入口

- `index.ts`
  Plugin entry and `research_workflow` tool registration.
- `index.ts`
  插件入口，以及 `research_workflow` 工具注册点。

- `tools/workflow-guard.ts`
  Runtime workflow guard, deterministic auto iterator, mailbox, cooldown, and structured state helpers.
- `tools/workflow-guard.ts`
  运行时 workflow guard、确定性 auto iterator、mailbox、cooldown 和结构化状态辅助逻辑。

- `WORKFLOW.md`
  Global workflow contract.
- `WORKFLOW.md`
  全局 workflow 契约。

- `WORKSPACE.md`
  Workspace ownership and file scope rules.
- `WORKSPACE.md`
  工作区所有权与文件范围规则。

- `DOC/README.md`
  Consolidated documentation entry.
- `DOC/README.md`
  统一的文档入口。

## Related Projects | 相关项目

- `PaperNexus`
  Knowledge graph tooling for local academic PDFs and Markdown.
- `PaperNexus`
  面向本地论文 PDF 与 Markdown 的知识图谱工具。

- `openclaw`
  The upstream OpenClaw source tree that provides the agent runtime, hooks, sessions, and heartbeat system.
- `openclaw`
  上游 OpenClaw 源码仓库，提供 agent runtime、hooks、sessions 和 heartbeat 机制。
