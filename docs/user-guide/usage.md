# 使用指南

这页只讲一件事：

“安装完成以后，怎么真正把一个项目跑起来？”

如果你还没完成环境准备，先看 [安装指南](./installation.md)。

## 1. 先选项目类型

你只需要先分清两条主线：

### A. 实验论文主线

适合：

- 你要提出新方法
- 你要写代码、跑实验、分析结果
- 最后形成方法论文

入口命令：

```text
/auto-research "你的主题"
```

例子：

```text
/auto-research "confirmation bias mitigation for generalized category discovery"
```

### B. 科研综述主线

适合：

- 你要做 survey / review
- 你要先收集文献、做 screening、coverage、gap synthesis
- 最后写的是综述论文，不是实验方法稿

入口命令：

```text
/auto-review "你的主题"
```

例子：

```text
/auto-review "generalized category discovery survey"
```

> [!TIP]
> 如果目标是综述，不要先走实验论文那条默认路径。直接从 `/auto-review` 或 `/survey-pipeline` 开始。

## 2. 让系统自动建项目

第一次不需要手工搭骨架。

系统会自动创建最小项目结构，常见包括：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `.openclaw-research/` 运行时状态目录

此时先确认两件事：

1. 项目目录已经出现。
2. `PROJECT_MANIFEST.json.current_stage` 已经有值。

## 3. 先看状态，不要猜状态

项目启动以后，先看：

```text
/workflow-status
```

如果你在工具侧，优先看：

- `PROJECT_MANIFEST.json`
- `.openclaw-research/workflow-runtime-queue.json`
- `.openclaw-research/workflow-events.jsonl`

重点字段：

- `current_stage`
- `current_micro_stage`
- `owner_agent`
- `next_action`
- `blocking_reason`

## 4. 项目卡住时先看什么

### 实验项目卡在 `setup`

优先检查：

- `research_program.goal`
- `baseline_reference`
- `primary_metric`
- `datasets`
- `success_criteria`
- `zotero_project_path`

### 一直回到 `graph_build`

优先检查：

- `paper_ingestion.graph_presence_status`
- `graph/GRAPH_PRESENCE_CHECK.json`
- `graph/GRAPH_BUILD_REPORT.md`

### 综述项目停在 `survey_review`

优先检查：

- `researcher/SURVEY_QUERY_REGISTRY.json`
- `researcher/INCLUDED_PAPERS.json`
- `researcher/EXCLUDED_PAPERS.json`
- `researcher/LITERATURE_REVIEW.md`
- `researcher/GAP_SYNTHESIS.md`
- `researcher/SURVEY_BRIEF.md`

## 5. 会话断了以后怎么恢复

正确恢复方式是：

```text
/resume-pipeline
```

不要靠聊天历史继续往下写，也不要手动猜当前 stage。

## 6. 最短路线

### 实验项目

```text
安装完成
  -> /auto-research "topic"
  -> /workflow-status
  -> 看 blocking_reason / next_action
  -> /resume-pipeline
```

### 综述项目

```text
安装完成
  -> /auto-review "topic"
  -> /workflow-status
  -> 看 survey_review packet 是否开始 materialize
  -> /resume-pipeline
```

## 7. 再深入看哪里

当你已经能把项目跑起来，再继续看：

1. [项目生命周期](../get-started/project-lifecycle.md)
2. [流程介绍](./workflow-tour.md)
3. [Slash Commands 总览](./slash-commands.md)
4. [技术文档入口](../technical/index.md)
