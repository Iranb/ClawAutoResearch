# 状态文件与项目产物

## 1. 设计原则

当前 workflow 的核心设计之一是：  
“让关键事实存到文件里，而不是留在对话记忆里。”

## 2. 顶层状态文件

### `PROJECT_MANIFEST.json`

这是单项目的总状态入口。  
当前至少包含这些重要块：

- `project_id`
- `owner_agent`
- `current_stage`
- `current_micro_stage`
- `next_action`
- `resume_action`
- `blocking_reason`
- `required_artifacts`
- `graph_reasoning`
- `idle_research`
- `experiment_memory`
- `innovation_reflection`
- `writing_contract`
- `paper_ingestion`
- `graph_watch`
- `memory_scope`
- `audit`
- `handoff`

### `TRACK_REGISTRY.json`

用于记录当前项目的研究 track 组合，包括：

- active track
- parked track
- killed track
- primary track
- track 结果和状态

### `PROJECTS_STATE.json`

项目总注册表，用于并行项目总览和调度。

## 3. Researcher 目录下的重要文件

### `researcher/GATE_STATE.json`

用于记录 gate 与阶段推进背景，支持恢复和自动迭代。

### `researcher/EXPERIMENT_LEDGER.json`

当前最重要的实验账本，用于：

- 记录实验生命周期
- 支撑恢复
- 支撑创新反思
- 驱动 PaperNexus 同步

### `researcher/INNOVATION_REFLECTION.md`

记录实验后对创新方向的反思结果。  
当 experiments 产生新证据后，这个文件会成为新 ideation 的前置输入。

### `researcher/EXPERIMENT_REGISTRY.md`

面向人类可读的实验清单，与 ledger 配合使用。

### `researcher/FRONTIER_REPORT.md`

frontier mapping 产出的前沿方向报告。

### `researcher/IDEA_REPORT.md`

idea 阶段主要输出。

### `researcher/IDEA_AUDIT.md`

idea 阶段的审计材料。

## 4. 图谱与文献相关目录

### `graph/`

图谱相关的 workflow-facing 产物所在目录，例如 build report、presence check 和 frontier files。默认不再要求单独维护 `subgraphs/` 目录。

### `memory/`

研究过程中的记忆文件和补充材料目录。

### `paper_source_dir`

项目论文源目录，通常在 manifest 中记录。

默认建议值是：

- `~/.papernexus/papers/{project_id}`

推荐把 Markdown / PDF 论文源统一放在这个本机默认 PaperNexus 源目录下。

### `graph_source_dir`

当前项目最近一次建图所使用的源目录。

默认建议值是：

- `~/.papernexus/papers/{project_id}`

注意：

- `graph_source_dir` 记录的是“建图输入源目录”
- 它通常和 `paper_source_dir` 相同
- 它不是最终图数据库文件所在目录
- 默认图索引通常位于 `~/.papernexus/index-store/.papernexus/`

## 5. Writer 与评审阶段产物

### `academic_writer/`

常见产物包括：

- `PAPER_PLAN.md`
- `TEMPLATE_MAPPING.md`
- section drafts
- 编译相关输出

### `reviewer/`

常见产物包括：

- `REVIEW_PACKET`
- grading 结果
- review response
- submit checklist

## 6. 隐藏状态目录

### `.openclaw-research/workflow-mailbox.json`

项目私有 mailbox，保存结构化 handoff / blocker / request / note。

### `.openclaw-research/workflow-contact-log.json`

记录 Agent 之间的联系历史，用于 cooldown 计算。

### `.openclaw-research/channel-project-bindings.json`

当启用 channel-project binding 且没有显式 `channelProjectBindingsPath` 时，这个文件默认写到当前项目目录下：`{PROJ}/.openclaw-research/channel-project-bindings.json`。  
如果当前 turn 还没有解析出项目，才会暂时回退到 workspace 下的 `.openclaw-research/channel-project-bindings.json`。  
它保存 Discord / session channel 到项目目录的绑定关系。

## 7. 哪些文件不建议手改

以下文件尤其不建议在活跃 workflow 中直接手工编辑：

- `PROJECT_MANIFEST.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `.openclaw-research/workflow-mailbox.json`
- `.openclaw-research/workflow-contact-log.json`
- `.openclaw-research/channel-project-bindings.json`

更推荐用这些工具动作：

- `research_workflow.set_idle_research`
- `research_workflow.record_idle_research_run`
- `research_workflow.upsert_experiment`
- `research_workflow.record_innovation_reflection`
- `research_workflow.set_writing_contract`
- `research_workflow.bind_channel_project`
- `research_workflow.unbind_channel_project`
- `research_workflow.send_mailbox`
- `research_workflow.ack_mailbox`
