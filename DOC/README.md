# OpenClaw Research DOC

这套文档服务于 `openclaw-research`，目标是把“先了解系统、再安装、再运行、最后查细节”这条路径整理清楚。

## 从哪里开始

如果你第一次接触这个仓库，建议按下面顺序读：

1. [新手快速开始（中文）](./beginner_zh.md)
2. [系统概览（中文）](./overview_zh.md)
3. [Overview (English)](./overview.md)
4. [Workflow Web Handbook / 系统工作流网页总手册](./web/workflow-handbook.html)
5. [快速上手](./guides/getting-started.md)
6. [系统架构](./concepts/architecture.md)
7. [科研工作流与自动迭代器](./concepts/workflow-and-auto-iterator.md)
8. [安装与启用](./guides/install-and-enable.md)
9. [配置项参考](./reference/configuration.md)

## 按任务导航

### 我想快速跑起来

- [新手快速开始（中文）](./beginner_zh.md)
- [系统概览（中文）](./overview_zh.md)
- [Workflow Web Handbook / 系统工作流网页总手册](./web/workflow-handbook.html)
- [快速上手](./guides/getting-started.md)
- [安装与启用](./guides/install-and-enable.md)
- [配置项参考](./reference/configuration.md)

### 我想理解整体设计

- [Overview (English)](./overview.md)
- [系统概览（中文）](./overview_zh.md)
- [Workflow Web Handbook / 系统工作流网页总手册](./web/workflow-handbook.html)
- [系统架构](./concepts/architecture.md)
- [科研工作流与自动迭代器](./concepts/workflow-and-auto-iterator.md)
- [PaperNexus、实验记忆与反思机制](./concepts/papernexus-memory-and-reflection.md)

### 我想知道某个文件或工具是干什么的

- [Agent 角色与目录配置](./reference/agents.md)
- [Skills 总表](./reference/skills.md)
- [插件工具接口](./reference/plugin-tools.md)
- [状态文件与项目产物](./reference/state-files.md)
- [斜杠命令与技能入口](./reference/slash-commands.md)
- [Workflow Web Handbook / 系统工作流网页总手册](./web/workflow-handbook.html)

### 我想排查运行问题

- [运行、调试与测试](./guides/operations-and-testing.md)
- [Coder 数据集路径约束](./reference/coder-dataset-paths.md)
- [配置项参考](./reference/configuration.md)

## 文档入口怎么分工

- [beginner_zh.md](./beginner_zh.md)
  第一次使用时最适合先看的短文档。
- [overview_zh.md](./overview_zh.md)
  中文系统总览，包含 Auto mode 和自动讨论能力概览。
- [overview.md](./overview.md)
  英文系统总览。
- [web/workflow-handbook.html](./web/workflow-handbook.html)
  面向浏览器的系统工作流总手册，详细解释当前真实实现、阶段闭环、PaperNexus 联动和各环节质量控制。
- [WORKFLOW.md](./../WORKFLOW.md)
  人类可读的 workflow 契约与阶段规则。
- [WORKSPACE.md](./../WORKSPACE.md)
  目录结构、路径约定和角色写入边界。
- [CONFIG.md](./../CONFIG.md)
  路径与配置速查，不再承担总介绍。

## 文档分层

### Concepts

- [系统架构](./concepts/architecture.md)
  讲清系统分层、核心控制回路和为什么需要插件约束。
- [科研工作流与自动迭代器](./concepts/workflow-and-auto-iterator.md)
  讲清阶段机、auto iterator、硬 gate 和自动推进逻辑。
- [PaperNexus、实验记忆与反思机制](./concepts/papernexus-memory-and-reflection.md)
  讲清文献摄取链路、图谱、实验账本和反思机制。

### Reference

- [Agent 角色与目录配置](./reference/agents.md)
- [Skills 总表](./reference/skills.md)
- [插件工具接口](./reference/plugin-tools.md)
- [状态文件与项目产物](./reference/state-files.md)
- [配置项参考](./reference/configuration.md)
- [斜杠命令与技能入口](./reference/slash-commands.md)
- [Coder 数据集路径约束](./reference/coder-dataset-paths.md)

### Guides

- [新手快速开始（中文）](./beginner_zh.md)
- [系统概览（中文）](./overview_zh.md)
- [Overview (English)](./overview.md)
- [Workflow Web Handbook / 系统工作流网页总手册](./web/workflow-handbook.html)
- [快速上手](./guides/getting-started.md)
- [安装与启用](./guides/install-and-enable.md)
- [Lobster Handoff Quickstart](./../lobster/QUICKSTART.md)
- [运行、调试与测试](./guides/operations-and-testing.md)

## 这套文档当前覆盖什么

当前文档已经覆盖这些核心能力：

- 确定性的 `auto_iterator_tick`
- PaperNexus-first、Markdown-first 的文献与图谱链路
- graph presence hard gate
- `EXPERIMENT_LEDGER.json` 和创新反思 freshness
- `idle_research`
- `autoMode`、自动讨论、自动补救和动态降档
- `/workflow-status` 中的讨论可见性
- `writing_contract`
- mailbox、agent-to-agent 派发、mention 清洗和 cooldown
- channel-to-project binding

## 代码入口

- [index.ts](./../index.ts)
- [tools/workflow-guard.ts](./../tools/workflow-guard.ts)
- [tools/graph-presence.ts](./../tools/graph-presence.ts)
- [tools/research-memory.ts](./../tools/research-memory.ts)
