# 斜杠命令与技能入口

## 1. 说明

当前仓库里的“斜杠命令”本质上对应各角色 `skills/` 下的能力入口。  
如果你主要通过 Discord / OpenClaw chat 使用系统，建议把它们理解成 workflow 中的快捷调度点，而不是互相独立的零散命令。

## 2. 主流程命令

- `/research-pipeline`  
  完整科研主入口。适合从主题出发，让 Researcher 按 workflow 自动推进，并通过 PaperNexus Python wrappers 控制图谱流。

- `/resume-pipeline`  
  恢复中断项目。通常先读 manifest、gate、ledger，再继续 auto iterator。

- `/research-queue`  
  多项目队列与切换入口。适合维护多个并行研究项目。

## 3. 文献与图谱

- `/research-lit`  
  主题调研与持续文献跟踪，包含 project-local staging 和 wrapper-based PaperNexus import / reconciliation。

- `/papers-cool`  
  粗粒度检索论文入口。

- `/pasa-paper-search`  
  可选的第二检索源；如果成功，和 `papers-cool` 结果按 canonical identity 合并。

- `/hugging-face-paper-pages`  
  优先抓取论文 Markdown。

- `/arxiv2md-api`  
  当 Hugging Face 没有有效 Markdown 时，优先抓取 arxiv2md 的 direct raw markdown。

- `/arxiv2md`  
  当 direct raw markdown 不可用时，抓取 arxiv2md 页面端的 Markdown。

- `/graph-build`  
  构建或刷新项目图谱，走 PaperNexus Python wrappers 而不是手写 REST。

- `/papernexus`  
  直接调用 PaperNexus 能力，默认通过 wrappers 和 typed graph APIs。

- `/frontier-mapping`  
  基于图谱做研究前沿与空白映射，默认 wrapper-first。

## 4. 创新与反思

- `/idea-phase`  
  生成、筛选、收敛创新方向。

- `/innovation-reflection`  
  基于实验账本和 PaperNexus 刷新创新反思。

- `/idle-research`  
  在主流程等待时，围绕指定主题做 bounded background research。

- `/research-reflect`  
  汇总阶段性经验、失败模式和可复用模式。

## 5. 计划、实现、实验

- `/plan-phase` 或 Orchestrator 相关 planning skills  
  生成 `PLAN.md`、`TODOS.md`、`PLAN_AUDIT.md`。

- `/implement-experiment`  
  Coder 实现实验代码与复现结构。

- `/run-experiment`  
  启动和管理实验执行。

- `/parallel-experiments`  
  并行实验批次调度。

- `/monitor-experiment`  
  监控远程实验、结果目录和 screen 状态。

## 6. 分析、评审、写作

- `/analyze-results`  
  Analyzer 做结果解释和 claim-evidence 对齐。

- `/paper-plan`  
  Writer 建立论文结构与 template mapping。

- `/paper-write`  
  Writer 按 writing contract 写作。

- `/citation-preflight`  
  Writer 在提交前预检 bibliography，清理可疑引用并准备 `refs.bib`。

- `/paper-phase`  
  论文写作主流程。

- `/review-phase`  
  Reviewer 做内部评审与证据分级。

- `/citation-integrity-gate`  
  Reviewer 独立核验引用，写 `CITATION_VERIFICATION.md`，并更新 citation gate 状态。

## 7. 推荐使用方式

推荐优先级：

1. 大多数情况下先用 `/research-pipeline`
2. 项目中断后优先用 `/resume-pipeline`
3. 只有在你明确要干预某个阶段时，再单独调用阶段性命令

## 8. 相关文档

- [科研工作流与自动迭代器](../concepts/workflow-and-auto-iterator.md)
- [插件工具接口](./plugin-tools.md)
- [安装与启用](../guides/install-and-enable.md)
