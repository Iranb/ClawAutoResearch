# 插件工具接口

## 1. 总览

当前插件主要暴露两个工具：

- `research_memory`
- `research_workflow`

二者的职责不同：

- `research_memory` 管结构化研究记忆
- `research_workflow` 管项目状态、workflow、mailbox 和自动迭代

## 2. `research_memory`

### 2.1 作用

`research_memory` 的目标是避免 Agent 直接手改 memory markdown 或 review state 文件。

### 2.2 当前支持的动作

- `get_paths`
- `record_idea_entry`
- `record_experiment_entry`
- `record_failed_experiment_entry`
- `append_daily_log`
- `get_review_state`
- `set_review_state`
- `check_review_resumability`

### 2.3 适合存什么

- 创新想法
- 成功实验
- 失败实验
- 每日日志
- review state

### 2.4 策略配置

`research-memory.ts` 当前已经支持这些策略：

- 项目隔离开关
- 项目 ID 强制要求
- track ID 强制要求
- evidence pointer 强制要求
- review state 时效
- idea generation 配置
- track portfolio 配置
- compute budget 配置
- review loop 配置
- graph 配置

## 3. `research_workflow`

### 3.1 作用

`research_workflow` 是现在最重要的插件工具。  
它连接了 workflow snapshot、自动迭代器、共享图 presence check、idle research、实验账本、创新反思、写作约束和 mailbox。

### 3.2 当前支持的动作

- `get_snapshot`
- `check_graph_presence`
- `auto_iterator_tick`
- `get_idle_research`
- `set_idle_research`
- `record_idle_research_run`
- `get_experiment_memory`
- `get_innovation_reflection`
- `get_writing_contract`
- `upsert_experiment`
- `record_innovation_reflection`
- `set_writing_contract`
- `get_channel_project_binding`
- `bind_channel_project`
- `unbind_channel_project`
- `list_channel_project_bindings`
- `read_mailbox`
- `send_mailbox`
- `ack_mailbox`

## 4. 关键动作说明

### 4.1 `get_snapshot`

返回当前 workflow snapshot，通常包含：

- 当前项目
- 当前阶段
- owner
- missing stage signals
- allowed write scopes
- allowed contacts
- graph refresh 状态
- idle research 状态
- experiment ledger 摘要
- innovation reflection 状态
- writing contract 状态
- unread mailbox

### 4.2 `auto_iterator_tick`

这是自动迭代器入口。典型调用：

```json
{
  "action": "auto_iterator_tick",
  "iterator": {
    "mode": "heartbeat"
  }
}
```

可选字段里当前至少有：

- `mode`
- `queueMailbox`

### 4.3 `check_graph_presence`

用于把“图里是否已经有这些论文”做成真实检查，而不是只写一个时间戳。  
它会：

- 优先读取 `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` 作为本项目的 canonical paper selection
- 识别每篇 canonical paper 的 `source_kind`、`source_provider`、`retrieval_providers`，便于图谱追踪和来源审计
- 检查共享全局图对应 corpus 的 `.papernexus/sources.json`
- 回写 `PROJECT_MANIFEST.json.paper_ingestion.graph_presence_*`
- 生成 `{PROJ}/graph/GRAPH_PRESENCE_CHECK.json`

如果检查发现共享图中还缺 canonical papers，返回结果会是 `missing_papers` 或 `missing_corpus`；这会让 `graph_build -> frontier_mapping` 的推进被硬性阻断。

### 4.4 `set_idle_research`

用于配置空闲调研合同，例如：

```json
{
  "action": "set_idle_research",
  "idleResearch": {
    "enabled": true,
    "topic": "test-time adaptation for multimodal models",
    "query_seeds": ["test-time adaptation", "multimodal adaptation"],
    "preferred_venues": ["arxiv", "neurips", "icml"],
    "max_papers_per_cycle": 5,
    "cooldown_minutes": 30
  }
}
```

### 4.5 `upsert_experiment`

用于更新 `EXPERIMENT_LEDGER.json` 中的某个实验条目。  
推荐在这些时刻调用：

- queued
- launched
- running
- done
- failed
- decision made

### 4.6 `record_innovation_reflection`

在刷新 `INNOVATION_REFLECTION.md` 后回写 manifest 状态。

### 4.7 `set_writing_contract`

用于设置 Writer 的模版和段落逻辑合同，例如：

```json
{
  "action": "set_writing_contract",
  "writingContract": {
    "template_required": true,
    "template_path": "/absolute/path/to/template.md",
    "template_name": "conference-template",
    "section_order": [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "conclusion"
    ]
  }
}
```

### 4.8 mailbox 三件套

- `read_mailbox`
- `send_mailbox`
- `ack_mailbox`

它们负责：

- handoff
- blocker note
- request
- note

并将消息保存在项目私有 mailbox 文件中。

### 4.9 channel-project 绑定

- `get_channel_project_binding`
- `bind_channel_project`
- `unbind_channel_project`
- `list_channel_project_bindings`

这组动作是可选能力，用来把当前 Discord / session channel 绑定到某个项目目录。

开启后，workflow snapshot、auto iterator、mailbox、research memory 都会优先按当前频道绑定的项目解析，而不是只看全局 `OPENCLAW_PROJECT`。

补充：`auto_iterator_tick` 现在在 `graph_build / frontier_mapping / idea` 阶段会自动先跑一次 `check_graph_presence`。如果 graph presence 不是 `ready`，项目不会继续推进到 novelty-sensitive 的后续阶段。

## 5. 为什么要优先用工具而不是手改文件

原因有三个：

- 工具会做字段归一化
- 工具会同步 manifest 或关联状态
- 工具写入的数据更容易被 auto iterator 和 workflow guard 正确消费

## 6. 与 runtime hook 的关系

除了工具动作本身，插件还在运行时注册了这些 hook：

- `before_prompt_build`
- `before_tool_call`
- `message_sending`
- `subagent_spawning`

这些 hook 共同负责：

- 注入 workflow 上下文
- 拦截越界写入
- 清洗 Discord 中的原始 `@agent`
- 限制不合规的 spawn / send
