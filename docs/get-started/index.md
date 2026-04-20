# 快速开始

这一组页面现在更适合已经完成第一轮上手、想继续补齐“启动与恢复细节”的读者。

如果你是第一次进入这个系统，先读：

1. [用户文档入口](../user-guide/index.md)
2. [安装指南](../user-guide/installation.md)
3. [使用指南](../user-guide/usage.md)

这一组页面继续回答三个问题：

1. 这个插件怎么装进 OpenClaw。
2. 新实验项目或综述项目第一次应该怎么起步。
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

如果你现在只有一个主题，想让系统自动建项目并直接开跑，最快入口是：

- `/auto-research "topic"`
  适合实验论文主线。

- `/auto-review "topic"`
  适合综述 / review 主线，会直接创建 survey 项目并启动 `survey_review` 背景流程。

它们会自动创建/绑定项目；其中 `/auto-research` 会写入 topic-only onboarding placeholders 并以 `AUTO_PROCEED: true` 后台启动主科研流水线，`/auto-review` 则直接启动 survey 背景主线。

注意：如果你是从内部调试脚本或 Gateway `chat.send` 手动发这些命令，而不是从真实 workflow-enabled channel surface 进入，仍可能被 workflow session gate 拒绝。那种情况下，优先参考运维文档里的真实 `chat.send` 测试记录，而不要把它误判成命令逻辑本身失效。

### 4. 想做科研综述，却沿用实验项目的默认启动路径

如果目标是综述，不需要先走 `idea -> plan -> code -> experiment`。最短入口是直接运行 `/survey-pipeline "topic"`，让系统创建轻量 survey workspace，并围绕 `survey_review` durable state 推进到 survey-mode writing。

## 最短路径

```text
实验项目:
install.sh
  -> /project-init
  -> /graph-build
  -> /research-pipeline
  -> /workflow-status
  -> /resume-pipeline

科研综述:
install.sh
  -> /survey-pipeline "topic"
  -> /workflow-status
  -> /resume-pipeline
```

## 这几页会覆盖什么

| 页面 | 重点 |
| --- | --- |
| `installation.md` | 安装脚本、配置、工具许可、heartbeat、PaperNexus 访问 |
| `project-lifecycle.md` | 实验主线与综述主线、如何启动综述项目、graph presence、resume、常见恢复动作 |
