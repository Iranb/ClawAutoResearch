# PaperNexus、项目记忆与反思机制

## 1. 基本边界

当前架构应按一个更清晰的前提理解：

- 论文搜索、候选合并、全文解析、论文摄取、图谱构建、图谱刷新都交给 `PaperNexus`
- `AutoResearch` 不再自己维护一套并行的论文搜索和构图流程
- `AutoResearch` 只控制项目级状态、证据门槛、调研缺口、反思循环和阶段推进

也就是说，PaperNexus 是研究知识底座；AutoResearch 是围绕这个底座运行的科研 workflow 控制面。

这个边界能减少两类不稳定：

- 同一篇论文在本地搜索链路、PaperNexus 图谱和 workflow manifest 中出现多个事实来源
- Agent 根据上下文记忆或临时搜索结果推进 novelty、baseline、claim grounding，而不是根据可重放的图谱和证据状态推进

## 2. PaperNexus 负责什么

PaperNexus 是论文知识资产的权威所有者，负责：

- 文献发现：围绕主题、baseline、venue、reviewer concern、graph gap 执行查询
- 候选合并：按 DOI、arXiv ID、PMID、PMCID、规范化标题等身份合并候选
- 来源解析：优先 Markdown，必要时 PDF，保留 metadata-only 候选作为覆盖提示
- 论文摄取：解析正文、章节、引用、实验表格、方法和 claim
- 图谱构建：维护 paper、method、claim、evidence、dataset、benchmark、metric、limitation 等节点
- 图谱关系：维护 cites、uses、claims、benchmarked-on、supported-by-snippet、extends-method、contradicts 等关系
- 图谱查询：提供 research lookup、briefing、evidence chain、method lineage、idea catalyst 等能力
- 图谱刷新：在新论文、修复后的来源、重复论文合并或单篇 stale graph 出现时刷新权威图谱

因此，AutoResearch 不应该再把 `papers-cool`、`pasa-paper-search`、`hugging-face-paper-pages`、`arxiv2md` 等作为 workflow 层的稳定合同。它们可以是 PaperNexus 内部或兼容层的实现细节，但 workflow 只依赖 PaperNexus 返回的 discovery、source、graph、evidence 状态。

兼容层仍保留 markdown-first 来源顺序：`hugging-face-paper-pages` -> `arxiv2md-api` -> `markxiv` -> `arxiv2md` -> PDF fallback。若项目显式配置远程 PaperNexus 引擎，这条顺序只属于 PaperNexus/兼容层内部；远程引擎不可用时 AutoResearch 必须报错并阻塞，而不是改走本地检索或本地图谱。

## 3. AutoResearch 负责什么

AutoResearch 不拥有论文图谱本身，它拥有项目级科研控制状态。

主要职责是：

- 把当前项目问题转成 PaperNexus 可执行的调研 requisition
- 记录 PaperNexus import、discovery、graph refresh 的运行状态
- 判断哪些阶段需要 graph-backed 或 source-backed 证据才能继续
- 把 PaperNexus 查询结果物化为项目可读的 evidence packet、research memory 和 writing boundary
- 把实验结果、失败约束、论文证据和写作 claim 连接起来
- 在缺证据时阻止 agent 直接生成 novelty、baseline comparison 或 manuscript claim

权威项目状态仍然落在这些 artifact 上：

- `PROJECT_MANIFEST.json`
- `PROJECT_MANIFEST.json.paper_ingestion`
- `researcher/PAPER_SOURCE_INDEX.json`
- `graph/PAPERNEXUS_PROGRESS.json`
- `graph/PAPERNEXUS_STATUS.json`
- `graph/GRAPH_PRESENCE_CHECK.json`
- `researcher/literature-research-controller/*`
- `researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/INNOVATION_REFLECTION.md`

## 4. 推荐的项目记忆模型

项目记忆不要等同于“Agent 读过的论文摘要”。更稳的模型是一个 PaperNexus-backed project memory。

它可以按三层理解：

### 4.1 Capital layer

项目级总索引，回答“当前项目知道什么、缺什么、哪些证据可用”。

应记录：

- 当前 PaperNexus corpus
- 最近一次 graph fingerprint 或 refresh 时间
- 当前主题、baseline、method axis、dataset、metric、venue target
- active evidence gaps
- metadata-only but source-missing 候选
- stale 或需要刷新来源的论文
- downstream stage 对证据的最低要求

这个层面属于 AutoResearch，因为它服务于项目推进，而不是全局论文库。

### 4.2 Head layer

每个重要论文、方法、claim、benchmark 只暴露轻量 head，供 agent 决定是否需要展开。

一个 head 至少应包含：

- canonical paper identity
- title、year、venue
- method / problem / dataset / metric tags
- relevant graph edges
- source status: graph-backed、source-backed、metadata-only
- version or content fingerprint
- risk flags: stale、metadata-only、conflicting evidence、missing source span

这个层面主要由 PaperNexus 生成，AutoResearch 只缓存项目相关子集。

### 4.3 Evidence-card layer

真正进入 agent prompt 和 manuscript claim 的应该是 evidence card，而不是未约束的全文摘要。

一张 evidence card 应包含：

- `claim_boundary`：这张卡能支持的外部可见 claim
- `logic_sketch`：论文中的最小机制或实验逻辑
- `assumptions`：协议版本、dataset split、metric、baseline 设置、适用范围
- `source_spans`：可回查的论文、章节、段落、表格或 snippet
- `version_scope`：该证据对应的版本、时间、来源 fingerprint
- `allowed_use`：可用于 taxonomy、baseline comparison、novelty check、method design、writing claim 中的哪一种
- `risk_flags`：metadata-only、abstract-only、conflict、deprecated、needs refresh

metadata-only 候选可以影响覆盖判断和后续搜索方向，但不能作为 manuscript claim、结果对比或 novelty claim 的证据。

## 5. 论文调研阶段的控制方式

论文调研不应该是“让 Researcher 自由多搜几篇论文”。它应该是一个闭环：

1. AutoResearch 读取项目目标、当前 stage、已有实验、reviewer concern 和缺失信号
2. AutoResearch 生成或更新调研 requisition
3. PaperNexus 执行 discovery、source resolution、import 和 graph refresh
4. AutoResearch 读取 PaperNexus 的完成状态、coverage、graph presence 和 evidence chain
5. AutoResearch 物化项目 evidence packet 和 memory heads
6. 如果证据不足，继续向 PaperNexus 发 bounded follow-up requisition
7. 如果证据足够，允许进入 frontier mapping、idea、plan、write 或 review

每一轮调研都应该显式回答：

- 当前研究问题是什么
- 已有 source-backed 支持是什么
- 已有冲突、限制或 negative evidence 是什么
- 缺口是 coverage 缺口、source 缺口、graph refresh 缺口，还是 reasoning 缺口
- 下一步是 PaperNexus discovery、supplement、import、refresh，还是 workflow 阶段推进

## 6. Agent 应该如何读论文

Agent 读论文时不要从全文开始。推荐顺序是：

1. 读 PaperNexus head，判断论文是否和当前问题、baseline、method axis、dataset 或 metric 相关
2. 读 graph path，判断相关性来自 cites、benchmarked-on、extends-method、contradicts 还是 supported-by-snippet
3. 只展开必要的 evidence span、method section、experiment table 或 limitation section
4. 生成 evidence card
5. 基于 evidence card 做进一步推理

推理输出必须区分四类内容：

- source fact：来自论文原文或 source span
- graph fact：来自 PaperNexus 图谱关系
- workflow fact：来自实验账本、manifest、review state
- inference：Agent 根据上述证据做出的解释或下一步建议

如果只能得到 metadata、abstract 或模型记忆，输出应标记为 open gap，而不是把它写成事实。

## 7. 实验记忆与论文记忆的连接

`researcher/EXPERIMENT_LEDGER.json` 是实验记忆的权威来源。它记录：

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

论文证据和实验记忆的连接点是 `evidencePointers` 与 `papernexusSync`。

原则：

- 实验 claim 必须能指向本项目实验 artifact
- baseline 或 prior-work claim 必须能指向 PaperNexus evidence card
- 失败实验要进入 reflection，不能只停留在 runtime log
- 下一轮 ideation 必须同时读取 PaperNexus evidence 和 experiment ledger

## 8. 创新反思机制

`Experiment-Informed Innovation Reflection Contract` 的目标不是写一篇总结，而是更新项目的科研约束。

当实验账本中出现新的可反思证据时，serious ideation 前必须刷新：

- `researcher/INNOVATION_REFLECTION.md`
- manifest 中的 reflection 状态
- 与 PaperNexus evidence 相关的 support、contradiction、negative constraint

反思结果应明确：

- 哪些论文证据仍然支持当前方向
- 哪些实验结果削弱了原来的假设
- 哪些 baseline 或 protocol 需要重新对齐
- 哪些方向已经成为 dead end
- 下一轮 PaperNexus 调研要补哪些证据

## 9. idle_research 的新定位

`idle_research` 仍然是后台调研合同，但它不应该直接驱动随意搜索。

它应该变成 PaperNexus requisition 的调度器：

- 到期时，根据 topic、objective、query seeds、preferred venues 生成 bounded PaperNexus discovery request
- discovery 完成后，更新 `paper_ingestion`、coverage、graph presence 和 evidence packet
- 如果只拿到 metadata-only 候选，保留为 coverage limitation 和 supplement target
- 如果拿到 source-backed 证据，刷新项目 memory heads 和 evidence cards

这样 Researcher 空闲时做的是可重放的项目记忆维护，而不是上下文漂移式调研。

## 10. Writer 和 Reviewer 的证据边界

写作阶段依赖上游项目记忆，但不能把所有 PaperNexus 输出都当成可写入 claim 的证据。

Writer 可使用：

- source-backed evidence cards
- PaperNexus evidence packet
- Analyzer 的 claim-evidence 材料
- `INNOVATION_REFLECTION.md`
- `TRACK_REGISTRY.json`
- `writing_contract`
- 实验 artifact 和 reproducibility packet

Writer 不可使用：

- metadata-only 候选来支撑 claim
- abstract-only 信息来支撑具体 baseline 数字
- graph node summary 来替代 source span
- 模型记忆来补 DOI、venue、dataset、metric 或实验结果

Reviewer 应把 claim 分成：

- supported：有 source span 或实验 artifact
- partial：有 graph 或 metadata 支持，但缺 source span
- unsupported：没有可审计证据

unsupported claim 应转成 TODO、弱化表达或 PaperNexus follow-up requisition。

## 11. 当前机制的收益

在这个边界下，收益更明确：

- PaperNexus 统一承担论文搜索和构图，避免 AutoResearch 维护重复知识链路
- AutoResearch 只判断证据是否足够、是否 stale、是否允许推进阶段
- Agent 不再靠“读过的论文摘要”做长期记忆，而是靠项目 memory heads 和 evidence cards
- 创新点生成会同时考虑 prior work、实验失败、negative constraints 和 reviewer concerns
- 写作、review、ideation、analysis 使用同一套证据边界

## 12. 最重要的工程原则

- 不要把 PaperNexus discovery 结果等同于 source-backed evidence
- 不要把 graph presence ready 等同于所有 claim ready
- 不要让 Researcher 在 graph 或 source 状态不明时推进 novelty-sensitive work
- 不要让 Writer 写出没有 evidence card 或实验 artifact 支撑的具体 claim
- 当证据不足时，生成 PaperNexus follow-up requisition，而不是让 agent 自由发挥
- 当 PaperNexus 图谱更新后，刷新项目 memory heads 和 evidence packet，再推进 workflow
