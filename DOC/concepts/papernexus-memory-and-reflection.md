# PaperNexus、实验记忆与反思机制

## 1. 为什么要把 PaperNexus 接进 workflow

如果没有外部知识底座，Agent 的创新点、实验解释和写作论证很容易退化成：

- 只依赖最近上下文
- 忘记已读论文
- 不记得失败试验
- 创新提案和已有证据脱节

当前代码把 `PaperNexus + 实验账本 + workflow 状态` 连接起来，就是为了解决这个问题。

## 2. 文献摄取链路

当前推荐链路已经固定成：

1. 先用 `papers-cool` 检索论文，必要时可合并 `pasa-paper-search` 结果
2. 优先去 `hugging-face-paper-pages` 查找论文 Markdown
3. 如果 Hugging Face 没有有效 Markdown，再尝试 `arxiv2md`
4. 如果两路 Markdown 都失败，再回退到 PDF 下载
5. 将新论文纳入图谱构建或刷新
6. 更新 `paper_ingestion` 和图谱相关状态

这样做的好处是：

- 尽量优先拿结构化 Markdown
- PDF 只作为最后 fallback
- 图谱刷新有明确触发条件

## 3. PaperNexus 在 workflow 中承担什么角色

PaperNexus 不是一个附属工具，而是 workflow 的研究知识底座，主要用于：

- frontier mapping
- 图谱驱动 brainstorm
- idea novelty grounding
- closest prior work 对比
- 实验结果反思
- 写作期 claim grounding

## 4. 实验账本

当前系统新增了 `researcher/EXPERIMENT_LEDGER.json` 作为重启安全的实验记忆中心。

它记录的信息包括：

- `experimentId`
- `trackId`
- `name`
- `kind`
- `status`
- `stage`
- `hypothesis`
- `configRef`
- `summary`
- `server`
- `gpuId`
- `screenName`
- `launchedAt`
- `completedAt`
- `decision`
- `metrics`
- `resultPaths`
- `evidencePointers`
- `papernexusSync`

重要原则：

- Agent 不应该手改 ledger
- 运行时更新应走 `research_workflow.upsert_experiment`
- ledger 是 experiment memory 的权威来源

## 5. 创新反思机制

当前 workflow 已经加入 `Experiment-Informed Innovation Reflection Contract`。

意思是：

- 一旦实验账本中出现新的可反思证据
- 下次 serious ideation 前必须先做 reflection
- 反思结果要写到 `researcher/INNOVATION_REFLECTION.md`
- 并通过 `research_workflow.record_innovation_reflection` 更新 manifest 状态

这使得“创新点生成”不再是一次性 brainstorm，而是建立在：

- 已有图谱
- 失败实验
- 成功实验
- transfer lesson
- negative constraint

之上。

## 6. idle_research

`idle_research` 是当前 workflow 的后台调研合同，保存在 `PROJECT_MANIFEST.json.idle_research`。

它包括：

- `enabled`
- `topic`
- `objective`
- `query_seeds`
- `preferred_venues`
- `max_papers_per_cycle`
- `cooldown_minutes`
- `last_run_at`
- `last_digest_path`
- `status`
- `refresh_graph_on_new_core_papers`

Researcher 空闲时，如果它到期了，不能再随意做泛化文献漂移，而是应该优先围绕指定 topic 执行 `/idle-research`。

## 7. Writer 也依赖这套记忆链路

写作阶段虽然主要由 `academic_writer` 执行，但它并不是孤立的。  
Writer 实际依赖这些上游知识：

- PaperNexus 图谱
- Analyzer 的 claim-evidence 材料
- `INNOVATION_REFLECTION.md`
- `TRACK_REGISTRY.json`
- `writing_contract`

这使得写作不只是“把结果写下来”，而是围绕前面已经形成的科研证据结构来写。

## 8. 当前这套机制带来的实际收益

- Agent 能记住做过哪些实验
- 新创新点不会忽略旧失败
- 空闲时能围绕指定主题持续积累
- PaperNexus 图谱成为跨阶段共享知识底座
- 写作、分析和 ideation 用的是同一份研究事实集
