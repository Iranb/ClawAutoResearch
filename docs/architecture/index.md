# 系统设计总览

`ClawAutoResearch` 的架构可以理解成四层叠在一起：

1. `OpenClaw plugin layer`
2. `workflow control plane`
3. `shared graph + project memory`
4. `role-based execution`

## 1. 插件层负责什么

插件层负责把 OpenClaw 的工具、命令、角色和工作区环境接进来。它不是简单注册几个函数，而是把整个科研流程的控制能力暴露出来。

## 2. 控制平面负责什么

控制平面决定：

- 当前项目处于哪个阶段。
- 当前 owner 是谁。
- 哪些信号缺失。
- 是否应前进、回退、repair 或等待人工。
- 哪些 contracts 需要 materialize。
- 哪些 handoff / mailbox / channel broadcast 该触发。

## 3. 图谱与记忆负责什么

PaperNexus shared graph 负责“整个系统记住外部世界”，项目 memory 和 experiment ledger 负责“整个系统记住自己已经做过什么”。

## 4. 角色执行层负责什么

Researcher、Orchestrator、Coder、Analyzer、Academic Writer、Reviewer、Cross-reviewer 不只是 prompt 角色，它们分别拥有不同的目录边界、工具使用方式和阶段职责。

## 推荐深入阅读

- [Workflow 控制平面](./workflow-control-plane.md)
- [Broad Paper Search](./broad-paper-search.md)
- [Workflow Hooks](./workflow-hooks.md)
- [Auto Research / Auto Review Handoffs](./auto-pipeline-handoffs.md)
- [Lobster Handoffs](./lobster-handoffs.md)
- [Graph 与 Memory](./graph-memory.md)
- [Agents 与 Skills](./agents-and-skills.md)
- [Writing 与 Review](./writing-and-review.md)
