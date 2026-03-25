# openclaw-research

`openclaw-research` 是一个面向自动化科研项目的 OpenClaw 插件，核心能力包括：

- 基于 PaperNexus 的文献摄取与图谱推理
- 确定性的工作流控制与阶段回退
- 结构化实验记忆与创新反思
- 多 Agent 协同的规划、编码、分析、审稿与写作
- 支持理论附录的 proof-aware 写作
- 可选的基于 Lobster 的确定性阶段交接

它适合需要跨多天运行、能够恢复、能够在 Discord 中分频道管理、并且必须保留返工与修订回环的科研流程。

## 新手入口

如果你是第一次使用，建议先不要从这份长文档开始啃。

先看这份更短的新手说明：

- [beginner_zh.md](./beginner_zh.md)

最短上手路径是：

1. `npm run build`
2. `bash install.sh`
3. 参考 `openclaw.RECOMMENDED.json` 合并最小配置
4. 先用 `autoMode = conservative`
5. 执行 `/research-pipeline "你的研究主题"`
6. 执行 `/workflow-status`

如果你最关心“系统到底有没有真的自动推进、自动讨论”，现在直接看 `/workflow-status` 就可以了。

## Auto Mode 能力总览

当前系统已经支持实用型 Auto mode，不再只是“给一点提示”。

### 1. 两种自动推进档位

- `conservative`
  - 尽量自动推进 workflow
  - 更适合第一次上线或想先稳一点的场景
- `aggressive`
  - 更积极地自动推进阶段、补救和 gate
  - 适合你已经熟悉项目结构、希望更高自动化时使用

### 2. 高风险时不会立刻降档

系统现在不是“一看到风险就马上变保守”。

新的逻辑是：

- 先识别风险
- 先发起多 Agent 讨论
- 先尝试补救
- 只有多轮讨论后仍然不能解决，才真正降档

### 3. 会自动组织讨论和补救

当前高风险控制面已经包括：

- Auto discussion panel
  - `researcher`
  - `analyzer`
  - `reviewer`
- 自动聚合讨论结果
- 自动生成 action items 和 blockers
- 自动把补救任务派给更合适的 owner

也就是说，系统不只是“判断有风险”，而是会先自己讨论“怎么修”。

### 4. `/workflow-status` 现在能看到什么

现在执行 `/workflow-status`，可以直接看到：

- `configuredAutoMode`
- `effectiveAutoMode`
- 风险等级和原因
- mitigation 轮次
- Auto discussion 当前状态
- Auto gate review 当前状态
- 每个参与讨论 Agent 的摘要、action items、blockers
- 每个 Agent 的原始 response 摘要

如果你想确认系统是否真的讨论过，而不是只看系统说“讨论过了”，这一项现在已经可见。

### 5. 推荐使用方式

建议按这个顺序启用：

1. 先用 `autoMode = conservative`
2. 跑一个真实项目
3. 观察 `/workflow-status` 里的讨论和补救链路
4. 确认稳定后，再切到 `autoMode = aggressive`

## 这个系统解决什么问题

这个插件的目标，是把“靠聊天上下文推进科研”的流程升级成“靠状态文件、插件工具、运行时约束和角色技能共同驱动”的流程。

系统依赖以下几类机制：

- 项目状态文件，例如 `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`EXPERIMENT_LEDGER.json`
- 插件工具，例如 `research_workflow`、`research_memory`
- workflow guard hook，在每轮运行前注入状态，并阻止越权操作
- 各角色 skill，对每一步应该怎么做进行明确约束

这让系统能够稳定完成：

- 新建与恢复科研项目
- 文献检索、全文获取和图谱构建
- 创新点生成与筛选
- 实验规划与代码实现
- 实验执行与监控
- 结果分析与理论抽象
- 论文写作与修订
- 频道进展汇报与 Agent 交接

## 系统当前的核心功能

### 1. 确定性的科研工作流

当前主流程是：

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`

系统通过 `research_workflow.auto_iterator_tick` 和 workflow guard 实现：

- 阶段 owner 明确
- 阶段前置条件明确
- 缺失关键状态时自动回退
- 下一阶段任务可被结构化派发
- 阶段切换自动在项目频道播报
- 项目可通过 `resume-pipeline` 恢复

同时保留返工能力：

- 如果实验不够，需要补实验，就不会强行前进
- 如果 Writer 写作后还要改稿，就保留在 WRITE
- 如果 Reviewer 要求缩 scope 或回退，也会显式回环

### 2. PaperNexus 驱动的文献与图谱闭环

当前的论文获取路径是 Markdown-first：

1. `papers-cool` 作为稳定保底检索
2. `pasa-paper-search` 作为可选第二检索源
3. `hugging-face-paper-pages` 优先获取 Markdown
4. `arxiv2md` 作为 arXiv Markdown fallback
5. 只有前两种 Markdown 都失败时才下载 PDF

系统还会维护：

- `PAPER_SOURCE_INDEX.json`

里面会记录：

- 论文 canonical identity
- `source_kind`
- `source_provider`
- `retrieval_providers`

这样后续图谱检查、刷新和复用就更稳定。

### 3. 调研阶段强制包含头脑风暴

头脑风暴现在不再只发生在 IDEA 阶段。

Researcher 在 `research-lit` 过程中必须维护：

- `researcher/RESEARCH_BRAINSTORM.md`

这份文件用于记录：

- 机制假设
- part-level 拆解机会
- manifold / capacity 假设
- 文献之间的矛盾与张力
- do-not-repeat 约束

之后的 `frontier-mapping` 必须建立在它之上做 refinement，而不是从零重新 brainstorm。

### 4. 结构化实验记忆

实验侧的权威状态来源是：

- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/EXPERIMENT_REGISTRY.md`
- `PROJECT_MANIFEST.json.experiment_memory`

它们支持：

- 队列、运行、完成、失败状态持久化
- 实验重启后恢复
- 实验到创新反思的联动
- 避免重复做失败实验

### 5. 创新反思

当实验结果已经改变创新空间时，系统会标记：

- `innovation_reflection` 过期

这时在进入新的严肃 ideation 前，Researcher 必须刷新：

- `researcher/INNOVATION_REFLECTION.md`

这样新的创新点不会无视旧实验结果，而是建立在：

- 图谱证据
- 真实实验结果
- “不要重试什么”的约束之上

### 6. 多 Agent 协作

当前主要角色包括：

- `researcher`：文献、图谱、创新、实验协调、状态总控
- `orchestrator`：实验计划与预算
- `coder`：代码实现与原子化远程实验启动
- `analyzer`：指标、图表、claim-evidence、theory/proof packet
- `reviewer`：内部科研审稿与回环控制
- `academic_writer`：论文计划、正文写作、编译与投稿前成稿
- `cross-reviewer`：大纲与 prose 审稿

插件还附带通信控制：

- 普通消息里的原始 `@agent` 会被清洗
- mailbox 可持久化
- agent-to-agent dispatch 可以主动唤醒下一位 owner
- cooldown 防止重复唤醒

### 7. Discord 频道绑定项目

当前系统支持可选的 channel-to-project binding：

- 一个频道绑定一个项目
- 不同频道可以对应不同科研项目
- 绑定优先落到项目目录下
- 结合 workflow，可以在项目频道内持续汇报和推进

### 8. Lobster 确定性交接

Lobster 在当前系统里不是用来替代 Researcher/Coder/Writer 的推理，而是用作：

- 阶段完成后的确定性交接封装
- 明确谁是下一阶段 owner
- 减少“前一个 Agent 做完了，后一个 Agent 没接上”的问题

当前的 Lobster handoff workflow 会：

- 调用 `auto_iterator_tick`
- 确认下一阶段和下一位 owner
- 必要时主动派发任务
- 保持频道阶段播报一致

但是，它不会破坏返工回环：

- Writer 还要改稿时，不会 handoff 到下一阶段
- Coder 还要修 dry-run 时，不会 handoff
- Reviewer 认为要补实验时，不会 handoff

参考：

- [lobster/QUICKSTART.md](../lobster/QUICKSTART.md)

### 9. 理论状态与 proof-aware 写作

系统现在已经有一个最小版理论对象层：

- `analyzer/THEORY_STATE.json`
- `analyzer/proof-packets/*.json`

Analyzer 还能进一步物化出：

- `academic_writer/THEORY_APPENDIX_PLAN.md`
- `academic_writer/paper/sections/appendix_theory.tex`

Writer 会在此基础上做 proof-aware 写作：

- 正文只保留精炼的 theorem / lemma / result 级别表述
- 更长的推导放到 appendix
- 理论强度不足时，用更保守的经验性表述

这还不是完整 theorem prover，但已经能支撑结构化理论附录写作。

### 10. 模板驱动的论文写作

Writer 支持 `writing_contract` 约束，包括：

- conference / journal 模式
- section order
- paragraph logic
- proof appendix path
- citation integrity gate
- 默认模板路径

最重要的一点是：

- 外部模板不会被直接修改
- 插件会先把模板复制到项目目录
- Writer 只修改项目内副本

## 仓库结构

几个最重要的入口：

- [index.ts](../index.ts)：插件入口和 hook 接线
- [tools/workflow-guard.ts](../tools/workflow-guard.ts)：主 workflow 策略引擎
- [tools/graph-presence.ts](../tools/graph-presence.ts)：图中论文存在性检查
- [WORKFLOW.md](../WORKFLOW.md)：总 workflow 契约
- [WORKSPACE.md](../WORKSPACE.md)：项目目录布局和归属规则
- [CONFIG.md](../CONFIG.md)：路径与配置速查
- [README.md](./README.md)：文档总入口

主要目录：

- `agents/`：角色配置与生命周期文件
- `skills/`：各角色执行合同
- `tools/`：插件运行逻辑
- `templates/`：项目模板与状态模板
- `lobster/`：Lobster handoff wrapper
- `tests/`：回归测试

## 安装方法

### 1. 构建插件

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
```

### 2. 运行安装脚本

```bash
bash install.sh --dry-run
bash install.sh
```

如果你不希望安装脚本通过 OpenClaw CLI 创建 agent：

```bash
bash install.sh --skip-agent-create
```

### 3. 合并配置到真实 OpenClaw 配置文件

请参考：

- [openclaw.RECOMMENDED.json](../openclaw.RECOMMENDED.json)
- [openclaw.plugin.json](../openclaw.plugin.json)
- [reference/configuration.md](./reference/configuration.md)

注意：

- 真正运行时默认读取的通常是 `~/.openclaw/openclaw.json`
- 仓库里的配置副本只是参考，不会自动生效

## 最基本的 OpenClaw 配置要求

至少要确保：

- `~/.openclaw/plugins` 被加载
- `openclaw-research` 被启用
- `plugins.entries.openclaw-research.config.projectsRoot` 已配置
- 工作角色允许 `research_workflow`
- `researcher` 是默认 owner
- `heartbeat.every = "30m"` 保持合理默认

一个最小插件配置示例：

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          "projectsRoot": "/Users/iranb/Downloads/AutoResearchProjects",
          "injectWorkflowContext": true,
          "enforceWorkflowBoundaries": true,
          "blockDiscordAgentMentions": true,
          "enableWorkflowMailbox": true,
          "heartbeatBackgroundChecks": true,
          "maxWorkflowInboxMessages": 6,
          "agentContactCooldownSeconds": 300,
          "enableChannelProjectBindings": true,
          "defaultConferenceTemplatePath": "",
          "defaultJournalTemplatePath": ""
        }
      }
    }
  }
}
```

## 建议的角色工具权限

一般建议：

- `researcher`：完整 workflow 控制能力
- `orchestrator`：规划 + `research_workflow`
- `coder`：实现 + `research_workflow`
- `analyzer`：分析 + `research_workflow`
- `reviewer`：审稿 + `research_workflow`
- `academic_writer`：写作 + `research_workflow`
- 使用 Lobster handoff 的角色还应允许 `lobster`

## 如何启动一个新科研项目

标准入口：

```text
/research-pipeline "your research topic" -- AUTO_PROCEED: true
```

通常会发生：

1. 插件解析或创建项目
2. 当前频道可绑定到该项目
3. 初始化项目状态
4. 开始文献摄取和调研
5. 后续通过 workflow 自动推进到图谱、创新、规划、代码、实验、分析、审稿、写作

如果你要显式绑定当前频道到项目：

```json
{
  "action": "bind_channel_project",
  "channelBinding": {
    "projectRoot": "/absolute/path/to/project"
  }
}
```

## 日常使用方式

### Researcher

Researcher 负责：

- 启动项目
- 管理文献和图谱状态
- 做创新生成和反思
- 编排实验
- 对齐整体项目状态

### 其他角色如何接力

推荐模式是：

1. 当前 owner 写完该阶段的 durable artifacts
2. 如果阶段真的完成，就调用 Lobster handoff
3. Lobster 确认下一位 owner 并派发任务
4. 如果当前阶段还要修，就留在原阶段，不前递

这就保留了：

- 代码返工
- 补实验
- 审稿后缩 scope
- 反复改稿

## 如何配置会议或期刊模板

可以在插件配置里设置默认模板：

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          "defaultConferenceTemplatePath": "/absolute/path/to/conference-template/main.tex",
          "defaultJournalTemplatePath": "/absolute/path/to/journal-template/main.tex"
        }
      }
    }
  }
}
```

然后在项目里通过 `writing_contract.paper_mode` 选择：

- `conference`
- `journal`

运行时行为：

- 模板会先复制到项目内
- 项目内副本成为实际写作模板
- Writer 只改项目副本

## Lobster 在当前系统中的定位

Lobster 不是研究推理引擎，而是：

- 确定性交接壳
- owner 切换控制器
- 减少阶段完成后断流的机制

不要在这些情况下向前 handoff：

- Writer 还要继续修改
- Coder 还要修实现
- Reviewer 要求更多实验
- Researcher 决定重开 ideation 或 experiment loop

参考：

- [lobster/QUICKSTART.md](../lobster/QUICKSTART.md)

## 文档入口

建议从这里继续看：

- [README.md](./README.md)

进一步阅读：

- [guides/getting-started.md](./guides/getting-started.md)
- [guides/install-and-enable.md](./guides/install-and-enable.md)
- [reference/configuration.md](./reference/configuration.md)
- [reference/plugin-tools.md](./reference/plugin-tools.md)
- [reference/state-files.md](./reference/state-files.md)
- [reference/agents.md](./reference/agents.md)
- [reference/skills.md](./reference/skills.md)

## 验证

重要改动后建议运行：

```bash
npm test
npm run build
```

在安装和部署前，最好保证仓库测试保持通过。
