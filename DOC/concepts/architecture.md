# 系统架构

## 1. 总体定位

`openclaw-research` 是一个面向 OpenClaw 的科研自动化插件。它把科研过程拆成多个专门 Agent，再用插件、状态文件、skills 和 workflow 共同约束这些 Agent 的行为。

系统目标不是“让某个 Agent 一次性完成科研”，而是实现：

- 阶段化推进
- 项目隔离
- 角色隔离
- 可恢复
- 可审计
- 可自动迭代

## 2. 架构分层

当前代码可以分成五层：

### 2.1 Agent 层

每个角色位于 `agents/<role>/` 下，当前主要角色有：

- `researcher`
- `orchestrator`
- `coder`
- `analyzer`
- `academic_writer`
- `reviewer`
- `cross-reviewer`

每个 Agent 目录现在都包含官方风格的配置文件：

- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `BOOT.md`
- `BOOTSTRAP.md`
- `HEARTBEAT.md`

其中 `researcher` 额外带有 `SERVER.md`。

### 2.2 Skill 层

Skills 放在 `skills/` 下，按角色分组。Skill 负责把某一类工作固化成流程，例如：

- 文献检索与下载
- PaperNexus 图谱构建
- Frontier Mapping
- Idea 生成与筛选
- 实验实施与监控
- 结果分析
- 论文写作与编译
- 审稿与回复

Skill 本质上是操作流程模板，但它们本身并不能强制执行所有边界，所以还需要插件层。

### 2.3 插件层

插件入口在 `index.ts`，核心提供两个工具：

- `research_memory`
- `research_workflow`

插件层负责两类事情：

1. 提供结构化读写接口  
   不让 Agent 直接手改关键状态文件，而是通过工具动作更新。

2. 在运行时约束 Agent  
   通过 hook 在 prompt 构建前、工具调用前、消息发送前和子 Agent 派生前执行检查。

### 2.4 状态层

系统不是依赖聊天历史作为“记忆”，而是依赖项目状态文件。最关键的文件有：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/GATE_STATE.json`
- `PROJECTS_STATE.json`
- `.openclaw-research/workflow-mailbox.json`
- `.openclaw-research/workflow-contact-log.json`

状态层承担三个作用：

- 恢复项目现场
- 驱动自动迭代器
- 给插件提供可验证的决策依据

### 2.5 外部知识层

系统集成了两条外部知识链：

- `papers-cool` 作为稳定检索基线，`pasa-paper-search` 作为可选第二检索源；二者合并后在确认论文身份后优先走 `hugging-face-paper-pages`，再走 `arxiv2md` 的 Markdown-first 获取链路
- `PaperNexus` 的 PDF/Markdown 图谱能力

这让文献发现、知识图谱、实验结果反思和创新生成可以共享同一套知识底座。

## 3. 关键控制回路

这套代码里最重要的控制回路有四个：

### 3.1 主科研回路

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit`

### 3.2 自动迭代回路

在 heartbeat、bootstrap、resume 等场景下，Researcher 会优先调用：

```json
{"action":"auto_iterator_tick","iterator":{"mode":"heartbeat"}}
```

这一步会做阶段检查、缺失信号识别、owner 路由、mailbox handoff、项目总状态同步。

### 3.3 文献与图谱回路

`papers-cool search (+ optional pasa-paper-search merge) -> once paper identity is confirmed -> hugging-face-paper-pages Markdown -> arxiv2md Markdown fallback -> PDF fallback only if both Markdown sources are unavailable -> graph refresh / PaperNexus`

### 3.4 实验与创新回路

`实验记录 -> EXPERIMENT_LEDGER.json -> innovation_reflection pending -> PaperNexus 反思 -> 新创新点`

## 4. 为什么它比纯 Prompt Workflow 更稳

单纯依赖 Prompt 的多 Agent 系统经常会遇到这些问题：

- 忘记自己做过什么
- 越界写文件
- 跳过阶段前置条件
- Discord 里乱 `@` 其他 Agent
- 空闲时行为漂移
- 写作时不遵守模版

这套代码通过以下方式补强：

- 用 `workflow-guard` 对角色、阶段、文件写入和通信做运行时检查
- 用 `research_workflow` 和 `research_memory` 提供结构化状态入口
- 用 `PROJECT_MANIFEST.json` 和 `EXPERIMENT_LEDGER.json` 取代聊天记忆
- 用 `auto_iterator_tick` 做确定性调度
- 用 `mailbox + cooldown + mention sanitize` 管理 Agent 通信

## 5. 当前最核心的源码文件

- `index.ts`  
  插件入口，暴露工具动作并注册 hook。

- `tools/workflow-guard.ts`  
  所有 workflow snapshot、越界检查、mailbox、cooldown、idle research、writing contract、innovation reflection、auto iterator 的核心逻辑都在这里。

- `tools/research-memory.ts`  
  负责结构化 research memory 的写入和 review state 管理。

- `WORKFLOW.md`  
  人类可读的流程总规范，也是 skills 与插件设计的行为蓝图。
