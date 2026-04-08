# 快速开始

这一组页面回答三个问题：

1. 这个插件怎么装进 OpenClaw。
2. 新项目第一次应该怎么起步。
3. 会话中断、Agent 换人、Discord 线程丢上下文以后，怎么从 durable state 恢复。

## 推荐阅读顺序

- [安装与启用](./installation.md)
- [项目生命周期](./project-lifecycle.md)
- [Workflow 控制平面](../architecture/workflow-control-plane.md)

## 起步时最容易犯的错

### 1. 还没建项目状态就直接让 Agent 自由发挥

这会导致所有“接下来该做什么”的事实都只留在聊天里。正确做法是先创建项目骨架，再让工具开始写 durable state。

### 2. 把 graph build 当成可选步骤

这套系统是 graph-sensitive 的。没有 graph presence，就不应该进入 novelty-sensitive 阶段。很多“为什么又回退到 `graph_build`”的问题，本质上都是共享图尚未 ready。

### 3. 出现恢复场景时继续沿着聊天历史往下写

正确恢复入口是 `/resume-pipeline` 与 `research_workflow.get_snapshot`。系统强调的是“从状态恢复”，而不是“从对话记忆恢复”。

## 最短路径

```text
install.sh
  -> /project-init
  -> /graph-build
  -> /research-pipeline
  -> /workflow-status
  -> /resume-pipeline
```

## 这几页会覆盖什么

| 页面 | 重点 |
| --- | --- |
| `installation.md` | 安装脚本、配置、工具许可、heartbeat、PaperNexus 访问 |
| `project-lifecycle.md` | setup 到 write 的主线、graph presence、resume、常见恢复动作 |
