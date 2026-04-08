# Commands 与 Tools

从 Agent 的视角看，这个插件真正暴露出来的系统能力主要来自 slash commands 和两组 runtime tools。

## 1. Slash commands

| Command | 作用 | 常见场景 |
| --- | --- | --- |
| `/project-init` | 初始化项目骨架 | 新建项目 |
| `/graph-build` | 构建或修复 graph presence | 共享图缺论文、graph 不 ready |
| `/research-pipeline` | 启动或继续主研究流程 | 想从当前项目状态持续推进 |
| `/research-queue` | 多项目排队推进 | 同时管理多个研究项目 |
| `/resume-pipeline` | 从 durable state 恢复 | 会话重启、上下文丢失、换频道 |
| `/workflow-status` | 查看阶段、blocking reason、auto discussion | 排障与人工诊断 |

## 2. `research_memory`

这是结构化研究记忆工具，常见动作包括：

- `get_paths`
- `record_idea_entry`
- `record_experiment_entry`
- `record_failed_experiment_entry`
- `append_daily_log`
- `get_review_state`
- `set_review_state`
- `check_review_resumability`

它的目标是让 idea / experiment / review 的记忆留在文件系统和结构化状态里，而不是留在聊天上下文里。

## 3. `research_workflow`

这是控制平面最重要的工具面。核心动作家族包括：

### Snapshot 与推进

- `get_snapshot`
- `auto_iterator_tick`
- `dispatch_task`
- gate state 相关动作

### Graph 与摄取

- `get_papernexus_remote_access`
- `get_papernexus_progress`
- `check_graph_presence`
- `queue_paper_ingestion`

### Contracts 与 materializers

- `materialize_ideation_contract`
- `set_research_program`
- `materialize_paper_story_state`
- `materialize_review_pressure_packet`
- `materialize_writing_support_artifacts`

### Coordination

- `read_mailbox`
- `send_mailbox`
- `ack_mailbox`
- channel binding 相关动作

### Experiment / QC / review

- `upsert_experiment`
- `get_paper_qc`
- `get_figure_qc`
- `get_citation_collection`
- `get_review_issue_tracker`

## 4. 为什么 `auto_iterator_tick` 是最重要的入口

只看命令表，容易误以为所有动作是平铺的。实际上 `auto_iterator_tick` 是把它们串起来的关键：它决定当前阶段该持有哪种工具动作、该 materialize 哪些 contract、是否应该回退到 `graph_build`、是否该等待人工。

## 5. command / tool / skill 的关系

- command：面向用户或频道的入口。
- tool：面向 Agent 的运行时接口。
- skill：面向角色的执行协议。

理解这三层的关系后，排查问题会容易很多。很多表面上的“skill 没做好”，其实是 tool state 没准备好，或者 command 进入点选错了。
