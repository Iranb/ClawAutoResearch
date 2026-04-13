# 基于 PaperNexus 图分析与 EvoScientist 约束的故事线架构整合计划

**日期：** 2026-04-04  
**作者：** Codex  
**语言：** 中文  
**范围：** 在不把所有智能都堆到 `openclaw-research` 的前提下，把论文 `2603.12226v1` 所代表的“研究生成故事线架构”与 EvoScientist / EvoSkills 中“创新约束 + 写作约束”的方法论整合进当前系统。  

---

## 1. 本文档要解决什么问题

当前系统已经有：

- 完整的科研 workflow 状态机
- workflow-owned 的 PaperNexus 图同步与图验证
- durable 的 `ideation_contract / paper_story_state / review_pressure_packet`
- Evo 风格的 writer / reviewer contract 与部分自动 materialization
- 第一版 IDEA-CATALYST 子流水线

但还没有把下面这件事彻底讲清楚：

> 如何把一篇强调“跨学科创新生成 / metacognitive control loop”的论文方法，与 EvoScientist 中强调的“创新点可审计、写作叙事可防守”的方法论，组合成一个真正适合当前系统的分层架构？

这里的关键不是“再给 workflow 加很多字段”，而是：

1. 明确哪些能力应该属于 `PaperNexus`
2. 明确哪些能力应该属于 `openclaw-research`
3. 明确当前系统已经能支撑到什么程度
4. 明确还差哪些能力，才能逼近“端到端高质量自动化科研”

---

## 2. 信息来源与边界

本计划主要基于以下内容：

1. 论文：
   - `/workspace/input/2603.12226v1.pdf`
   - 元数据确认标题为：
     `Sparking Scientific Creativity via LLM-Driven Interdisciplinary Inspiration`
2. 现有蓝图：
   - `docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`
3. 现有系统综述：
   - `docs/superpowers/plans/2026-04-03-openclaw-research-system-status-summary.zh-CN.md`
4. 现有下一阶段计划：
   - `docs/superpowers/plans/2026-04-03-openclaw-research-next-implementation-plan.zh-CN.md`
5. Evo 风格设计稿：
   - `docs/superpowers/specs/2026-04-02-evo-inspired-ideation-story-workflow-design.zh-CN.md`
6. 功能审查：
   - `/workspace/internal/artifacts/functional_audit_v2.md.resolved`
7. 当前 writer / reviewer skill：
   - `skills/academic_writer/paper-plan/SKILL.md`
   - `skills/academic_writer/paper-write/SKILL.md`
   - `skills/reviewer/paper-review/SKILL.md`

### 2.1 解释边界

本计划对 `2603.12226v1` 的吸收，**主要以当前蓝图和仓库内既有实现理解为准**，不试图在本仓库里复刻论文中的全部底层图谱算法。  
因此本计划关心的是：

- 如何把论文中的“研究生成控制架构”接进当前 workflow
- 如何把 EvoScientist 中“创新点约束 + 写作约束”接进当前 workflow
- 如何把 PaperNexus 当作图分析与证据底座，而不是把图智能复制到本仓库里

---

## 3. 先澄清：这里有两条“故事线”

如果不先拆开这两条线，后面实现一定会混乱。

### 3.1 研究生成故事线

这条线对应论文 `2603.12226v1` 和 IDEA-CATALYST 蓝图，核心是：

`问题分解 -> 机制抽象 -> 跨域匹配 -> 证据桥接 -> 重构候选 -> 对比评估 -> 研究提案`

它解决的是：

- 创新点从哪里来
- 为什么这个方向不是拍脑袋
- 为什么这个方向比其他候选更值得继续
- 当图谱证据不足时，应该补什么论文、补哪个域、补到什么程度
- 当当前图谱不足以支撑某个 challenge、bridge 或 claim 时，如何系统性发现下一批该补的论文

### 3.2 论文写作故事线

这条线对应 EvoScientist / EvoSkills 的 `paper-planning / paper-writing / paper-review`，核心是：

`task -> challenge -> insight -> contribution -> advantage`

并通过：

- `claim-to-experiment mapping`
- `fallback narrative`
- `rejection-risk table`
- `reject-first review`
- `novelty attack`
- `unsupported claim audit`

把“论文会不会被 reviewer 一眼打穿”这件事显式化。

### 3.3 这两条线在当前系统中的关系

理想关系不是“选一个替代另一个”，而是：

- **研究生成故事线** 决定：研究方向是否值得进入计划/代码/实验
- **论文写作故事线** 决定：这些研究结果如何被组织成可防守的论文叙事

也就是说：

- 前者服务 `idea / plan`
- 后者服务 `plan / code / experiment / analyze / review / write`

---

## 4. 当前系统已经能做到什么

基于当前代码与既有计划，`openclaw-research` 已经不是一个“概念性 workflow”，而是一个相当强的自动科研操作系统。

### 4.1 已经具备的硬能力

1. 完整阶段机
   - `setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`
2. project-local durable runtime
   - queue / session / outbox / trace / recovery / orchestrator
3. workflow-owned 的 PaperNexus 上传、graph verify、repair loop
4. `ideation_contract / paper_story_state / review_pressure_packet`
5. writer / reviewer 的 story-first 与 adversarial review 第一版
6. IDEA-CATALYST 的第一版状态、模块、requisition loop、rerun loop
7. graph-first 的 frontier / brainstorm / ideation grounding

### 4.2 当前已经具备的“高质量科研”雏形

当前系统已经可以做到：

- 把一个项目从 `setup` 自动推到 `write / submit` 前后
- 用 durable state 保留中间产物，而不是只靠聊天历史
- 用 graph 同步、claim-evidence、review pressure 阻止明显的低质量推进
- 在 bounded empirical ML 项目上支持“中高质量、半自治”的自动科研

### 4.3 当前系统的真实上限

当前系统**还不能稳定实现**“完全自主、持续高质量、接近顶会强创新标准”的自动科研。

真正的上限瓶颈不在 workflow，而在：

1. IDEA-CATALYST 还不够强的 graph-native / KG-native 研究智能
2. plan -> code -> experiment -> analyze 的 claim-binding 仍不够硬
3. writer / reviewer 还没成为真正强的 story-first scientific editor
4. PaperNexus 侧的 domain / mechanism / bridge primitive 仍未最终完成

一句话总结：

> 当前系统已经是一个强 workflow、强研究执行、部分强创新约束的自动科研系统；但还不是一个成熟的高质量自主研究员。

---

## 5. 论文 `2603.12226v1` 对当前系统最有价值的部分

从当前蓝图和实现看，这篇论文最重要的不是“五步流程”本身，而是下面这几个结构思想：

### 5.1 不是线性 pipeline，而是 metacognitive control loop

关键不是：

- 先 decomposition
- 再 abstraction
- 再 scouting

而是：

- 哪些问题已经被解决、哪些只是部分解决、哪些仍未探索
- 哪些 source domain 值得继续
- 哪些只是近邻领域的弱迁移
- 什么时候应该补图、补论文、重新跑 ideation
- 什么时候应该停止扩展，进入 plan

这意味着：

- `openclaw-research` 应该负责 **控制循环**
- `PaperNexus` 应该负责 **图证据与跨域桥接**

### 5.2 双层抽象是关键

论文强调的不只是“换一种表述”，而是：

- domain-specific challenge
- domain-agnostic mechanism

这正好对应：

- `PaperNexus` 负责抽 mechanism / bridge / analogy primitive
- `openclaw-research` 负责决定这些 primitive 是否足以推进到下一阶段

### 5.3 评估必须是比较式，不是单点打分

论文中的 ranking 本质上是：

- pairwise
- comparative
- multi-dimensional

而不是简单地给每个 idea 一个 novelty 分数。

这对当前系统意味着：

- `judge.ts` 的方向是对的
- 但它必须持续被当作一个**独立 evaluator loop**
- 不能退化回“生成时顺便打分”

### 5.4 论文的“故事线”更像研究推演线，而不是最终 paper prose 模板

因此：

- 不应该把这篇论文的 pipeline 直接当作 `paper-write` 模板
- 应该把它接到 `idea / plan` 阶段，变成研究方向生成和筛选的控制层
- 再由 EvoScientist 风格的 `paper story contract` 接手，组织最终论文叙事

### 5.5 “找论文”本身就是核心能力，而不是附属动作

这篇论文还有一个容易被忽略、但对当前系统极其重要的点：

> 高质量创新生成不只依赖“分析已经有的论文”，还依赖“知道下一步该去找什么论文、为什么找、找完以后是否真的补上了当前缺口”。

因此，“找论文”不应该只是：

- Researcher 临时手工搜索
- 或 agent 自由发挥式地追加几篇参考文献

它应该成为一个正式能力，服务于：

- unresolved challenge 的补料
- source-domain / mechanism bridge 的补料
- unsupported claim / rebuttal risk 的补料
- related-work / limitation / contradiction 的补料

也就是说，后续实现时必须把“论文发现 / 检索 / 补料”视为：

- IDEA-CATALYST 的前置能力
- requisition loop 的核心能力
- writer / reviewer 证据补强的核心能力

---

## 6. EvoScientist / EvoSkills 对当前系统最有价值的部分

EvoScientist 真正提供的，不是“更学术的 prompt”，而是三类高价值约束。

### 6.1 创新点必须有中间产物流

EvoScientist / EvoSkills 强调：

- novelty tree
- challenge-insight tree
- well-established solution check
- candidate pool
- tournament ranking
- top-3 summary
- research proposal

这些东西的价值在于：

- 创新点变成可比较
- 创新点变成可淘汰
- 创新点变成可沉淀

当前系统其实已经有一部分：

- `ideation_contract`
- `graph_ideation_indices`
- `CANDIDATE_POOL`
- `RESEARCH_PROPOSAL`
- `TOP3`

但还不够强。  
因此 Evo 方法论在当前系统里的正确落点，不是新增一套 memory，而是**继续增强现有 `ideation_contract`**。

### 6.2 写作不是最后才开始组织，而是要先有 story contract

Evo 的关键点是：

- 先定 story spine
- 再定 module motivation
- 再定 claim-to-experiment mapping
- 再定 fallback narrative
- 再做 reject-first review

当前系统已经有这条骨架：

- `paper_story_state`
- `STORY_SPINE.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`
- `FALLBACK_NARRATIVE.md`
- `REJECTION_RISK_TABLE.md`
- `review_pressure_packet`

所以 Evo 这部分不是“要不要引入”，而是**要不要继续强化为更严格的自动流**。

### 6.3 reviewer 必须是反向压力测试，而不是总结官

Evo 的 reviewer 价值在于：

- 先找拒稿理由
- 先删 unsupported claim
- 先攻击 novelty
- 先检查 reverse outline 和 limitation

当前系统已经有显式 skill：

- `paper-review`
- `review-phase`

但其输出还可以更强结构化、更稳定地回写 workflow contract。

---

## 7. 正确的系统分工：PaperNexus vs openclaw-research

这是本计划里最重要的设计结论。

## 7.1 应该放在 PaperNexus 的内容

PaperNexus 应当负责**图分析、语义抽取、跨域桥接、机制层证据**，而不是把这些逻辑复制到 `openclaw-research`。

### 7.1.1 PaperNexus 应负责的 primitive

至少包括：

- 文献发现与检索 primitive
- `fieldOfStudy / fieldCandidates / domainTags`
- domain distance
- `AbstractMechanism`
- problem -> mechanism / method -> mechanism 的桥接
- cross-domain bridge query
- challenge cluster / insight cluster
- occupied solution zones
- bridge nodes / mechanism matches
- evidence tier / bridge quality
- contradiction / limitation / assumption 关联

这里的“文献发现与检索 primitive”至少应支持：

- target-domain gap driven retrieval
- source-domain bridge driven retrieval
- contradiction / limitation driven retrieval
- writing-time support / rebuttal retrieval
- 去重、域标签过滤、近邻噪音抑制、按 bridge quality 排序

### 7.1.2 PaperNexus 应负责产出的高层 packet

后续最好提供稳定 contract，而不是让 `openclaw-research` 自己拼：

- `LITERATURE_DISCOVERY_PACKET`
- `DOMAIN_LANDSCAPE_PACKET`
- `MECHANISM_BRIDGE_PACKET`
- `CHALLENGE_INSIGHT_PACKET`
- `GRAPH_STORYLINE_PACKET`
- `DOMAIN_MATCHMAKING_PACKET`

这些 packet 的价值是：

- 为“下一步应该补什么论文”提供结构化决策依据
- 为 IDEA-CATALYST 提供 graph-native 依据
- 为 `paper_story_state` 提供 related-work / challenge / limitation 的图证据

## 7.2 应该放在 openclaw-research 的内容

`openclaw-research` 应负责 orchestration、state、stage gate 和 story/review 逻辑。

### 7.2.1 核心职责

- 阶段机与微阶段
- project-local durable state
- `ideation_contract / paper_story_state / review_pressure_packet`
- preflight / materializer / gate / regression / rerun
- writer / reviewer 自动流
- requisition -> ingestion -> rerun 的 workflow-owned 闭环
- discovery requisition -> literature ingestion -> graph refresh -> rerun 的 orchestration

### 7.2.2 不应该做的事

以下内容不应在本仓库中复刻：

- domain taxonomy 本体设计
- mechanism extraction 算法
- domain distance 算法
- bridge traversal 底层实现
- semantic KG writeback pipeline

如果这些内容被复制到 `openclaw-research`，结果一定是：

- contract 漂移
- 双端逻辑重复
- 图智能和 workflow 智能分裂

因此在“找论文”这件事上，应坚持一个简单规则：

- **PaperNexus 决定应该找什么论文、给出哪些候选、为什么这些候选值得补**
- **openclaw-research 决定什么时候触发这类检索、补完后回到哪个阶段继续推进**

---

## 8. 面向“故事线架构”的推荐整合方式

推荐把“故事线架构”做成两层合同，而不是新增第三套平行系统。

## 8.1 第一层：研究生成故事线

这层落在 `ideation_contract` 上。

### 8.1.1 它应回答的问题

- 目标问题空间是什么
- 还有哪些 unresolved / partial / unexplored challenge
- 哪些 challenge 具有非增量价值
- 哪些外域最值得借鉴
- 哪些 bridge 是真正有证据的，而不是表面类比
- 哪些候选方向值得进入 plan

### 8.1.2 建议增强的合同字段

继续强化现有 `graph_ideation_indices`，至少包括：

- `candidate_source_domains`
- `selected_source_domains`
- `pruned_source_domains`
- `bridge_evidence_tier`
- `coverage_by_question`
- `remaining_non_incremental_challenges`
- `mechanism_hypotheses`
- `domain_constraints`
- `domain_norms`
- `requisition_retry_budget`
- `requisition_saturated`

### 8.1.3 这层应由谁来驱动

- 图数据与 challenge/bridge primitive：`PaperNexus`
- packet materialization / rerun / stage routing：`openclaw-research`

## 8.2 第二层：论文叙事故事线

这层落在 `paper_story_state` 上。

### 8.2.1 它应回答的问题

- 论文真正解决的 challenge 是什么
- 对应 insight 是什么
- contribution 是哪几个
- 每个 contribution 带来什么 advantage
- 每个 claim 对应什么实验
- 主叙事失败时怎么切到 fallback narrative
- reviewer 最可能打击哪里

### 8.2.2 建议增强的合同字段

当前已有骨架，但可以继续增强：

- `storyline_source`
- `storyline_evidence_basis`
- `challenge_statement_status`
- `insight_summary_status`
- `contribution_map_status`
- `advantage_map_status`
- `claim_support_severity`
- `fallback_trigger_conditions`
- `rejection_risk_categories`
- `limitation_pressure_status`

### 8.2.3 这层应由谁来驱动

- challenge / prior-work tension / limitation evidence：优先从 `PaperNexus` 图 packet 读
- story contract 组织、claim binding、write/review gate：由 `openclaw-research` 负责

---

## 9. 对当前系统的现实判断：能支撑到什么程度

### 9.1 当前就能支撑的程度

如果只看 `openclaw-research` 当前已实现能力，它已经能支撑：

1. **端到端自动科研 workflow**
   - 从 `setup` 到 `write / submit`
2. **bounded empirical ML 项目的中高质量自动执行**
   - 前提是问题、数据、baseline、评估协议相对清晰
3. **有较强约束的创新生成第一版**
   - 不是随便 brainstorm
4. **有较强约束的写作与自审第一版**
   - 不是“先写出来再看”

### 9.2 当前还不能稳定支撑的程度

当前系统还不能稳定支撑：

1. **开放式问题上的持续高质量强创新**
2. **真正强的跨域类比创新**
3. **近似顶会级的自动 story engineering**
4. **几乎无人值守的长期多项目自主科研**

### 9.3 如果 PaperNexus 侧补齐后，系统上限会到哪里

如果 `PaperNexus` 侧把 domain / mechanism / bridge / storyline evidence primitive 补齐，并且本计划中的 openclaw-research 侧整合完成，那么系统有机会达到：

- **高质量半自治科研系统**
- **在 bounded 领域中较稳定地产出可防守的研究方向**
- **在写作阶段形成更像真正 researcher/reviewer 对抗链的故事线组织**

但即便如此，它仍然更像：

- 一个强大的自动科研操作系统

而不是：

- 一个完全成熟、无需监督的顶级自主研究员

---

## 10. 具体实施路线图

本路线图刻意分成两端：PaperNexus 端与 openclaw-research 端。

## 10.1 PaperNexus 端优先事项

### PNX-0：把“找论文”做成正式 research primitive

必须补齐一套 graph-native 的论文发现能力，而不是把它继续留在 agent 的自由搜索层：

- 按 unresolved challenge 生成检索任务
- 按 source-domain / mechanism bridge 生成跨域检索任务
- 按 unsupported claim / limitation / rebuttal risk 生成补证据检索任务
- 对检索结果做：
  - 去重
  - 域标签与距离过滤
  - bridge relevance 排序
  - 候选论文分桶
  - “是否值得入图”的筛选

理想输出是 `LITERATURE_DISCOVERY_PACKET`，至少应包含：

- `discovery_reason`
- `target_question_ids`
- `target_domains`
- `candidate_queries`
- `candidate_papers`
- `selected_papers`
- `rejected_papers`
- `selection_rationale`
- `evidence_gap_closed`
- `next_action_suggestion`

### PNX-1：补齐 graph-native storyline primitive

必须完成：

- domain tagging
- domain distance
- abstract mechanism
- bridge query
- challenge/insight packet
- evidence tier

### PNX-2：提供稳定 packet

至少产出：

- `DOMAIN_MATCHMAKING_PACKET`
- `MECHANISM_BRIDGE_PACKET`
- `CHALLENGE_INSIGHT_PACKET`
- `GRAPH_STORYLINE_PACKET`

### PNX-3：避免 openclaw-research 侧自己推断

只要某种 bridge/domain/mechanism 判断能由 PaperNexus 输出，就不要在 `openclaw-research` 里再用自由文本 heuristics 重做。

## 10.2 openclaw-research 端优先事项

### OCR-1：继续完成 IDEA-CATALYST 子流水线

重点增强：

- `decomposer.ts`
- `translator.ts`
- `scout-adapter.ts`
- `gatekeeper.ts`
- `integrator.ts`
- `judge.ts`

要求：

- 不要重回 `workflow-guard.ts`
- 优先放到 `tools/idea-catalyst/`

### OCR-2：把 PaperNexus packet 接到现有合同

重点接线：

- `ideation_contract`
- `graph_ideation_indices`
- `paper_story_state`

同时要把 `LITERATURE_DISCOVERY_PACKET` 接到：

- `idea_catalyst.requisition`
- `paper_ingestion.queued_requests`
- `graph_build/uploading`
- `review_pressure_packet`

优先修改位置：

- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/workflow-bridge.ts`
- `tools/workflow-guard-state/ideation-contract.ts`
- `tools/workflow-guard-state/paper-story.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`

### OCR-3：继续收紧 plan -> code -> experiment -> analyze

把下面这些变成更强约束：

- `RESEARCH_PROPOSAL.md`
- `PROBLEM_DECOMPOSITION.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`
- claim support severity
- limitation / failure-case 回写

### OCR-4：继续收紧 writer / reviewer 自动流

把下面这些从“已有文件”推进成“更强自动流”：

- `STORY_SPINE.md`
- `MODULE_MOTIVATION_MAP.md`
- `FALLBACK_NARRATIVE.md`
- `REJECTION_RISK_TABLE.md`
- `REJECT_FIRST_REVIEW.md`
- `NOVELTY_ATTACK.md`
- `REVERSE_OUTLINE.md`
- `LIMITATION_AUDIT.md`

同时引入一类新的“写作补料”动作：

- 当 writer 或 reviewer 发现 related work / contradiction / limitation 证据不足时，不是只给出红灯
- 而是生成可回流到 `PaperNexus` 的 literature discovery requisition
- 再由 workflow 驱动：
  `review/write -> discovery requisition -> ingestion -> graph refresh -> story/review rerun`

### OCR-5：继续瘦 `workflow-guard.ts`

原则：

- 新逻辑优先放到：
  - `tools/idea-catalyst/`
  - `tools/workflow-guard-runtime/`
  - `tools/workflow-guard-stages/`
  - `tools/workflow-guard-state/`
  - `tools/workflow-guard-guidance/`
- `workflow-guard.ts` 只保留 facade / compatibility / glue

---

## 11. 推荐的最小实现方案

如果目标不是“一次性做到最强”，而是先把最值钱的部分落地，推荐最小方案如下：

### Step 1

先由 PaperNexus 提供：

- `LITERATURE_DISCOVERY_PACKET`
- `CHALLENGE_INSIGHT_PACKET`
- `MECHANISM_BRIDGE_PACKET`
- `GRAPH_STORYLINE_PACKET`

### Step 2

openclaw-research 在 `idea` 阶段消费这三个 packet，强化：

- Scout
- Gatekeeper
- Integrator
- Judge

并把结果稳定回写：

- `ideation_contract`
- `graph_ideation_indices`

此外，应把 `LITERATURE_DISCOVERY_PACKET` 接进 requisition loop，确保“补论文”不是旁路动作，而是正式阶段动作。

### Step 3

在 `paper-plan / paper-write / paper-review` 中消费 `GRAPH_STORYLINE_PACKET`，强化：

- challenge statement
- insight summary
- contribution / advantage mapping
- related work tension
- limitation boundary

并在发现证据缺口时，触发 graph-backed 文献补料，而不是只留人工 TODO。

### Step 4

让 `review_pressure_packet` 更强绑定上述 graph storyline evidence，而不是只做文本层审查。

---

## 12. 验收标准

当下面这些条件满足时，可以认为本计划进入“第一阶段完成”。

### 12.1 研究生成侧

1. `ideation_contract` 能稳定记录：
   - coverage by question
   - source-domain selection / pruning
   - bridge evidence tier
   - top ranked directions
   - literature discovery basis 与补料闭环状态
2. IDEA requisition 能稳定触发：
   - `paper_ingestion.queued_requests`
   - `graph_build` rerun
   - `idea` rerun
3. `judge` 不再只是单点分数，而是稳定 comparative loop
4. 系统能明确回答：
   - 为什么现在仍缺论文
   - 应该补哪类论文
   - 补完后哪个 challenge / claim 会被关闭

### 12.2 写作叙事侧

1. `paper_story_state` 能稳定记录：
   - challenge
   - insight
   - contribution
   - advantage
   - claim support severity
   - fallback narrative
2. writer 不是只读 `PAPER_PLAN.md`，而是真正消费 story contract
3. reviewer 不是只给泛意见，而是稳定输出 reject-first / novelty / reverse-outline / limitation stress test
4. 当 related work / contradiction / limitation 证据不足时，系统能发起结构化 literature discovery，而不是只留下开放式备注

### 12.3 系统级

1. 不需要把 domain / bridge 算法复制到 `openclaw-research`
2. 不新增平行 memory 系统
3. 新功能不继续堆回 `workflow-guard.ts`
4. 至少有一条 E2E 覆盖：
   - `graph_build -> frontier_mapping -> idea(catalyst) -> plan -> write/review`

---

## 13. 最终结论

当前系统的正确方向，不是把 `2603.12226v1` 里的所有机制都抄进 `openclaw-research`，而是：

1. 让 `PaperNexus` 成为：
   - graph-native 研究分析层
   - challenge / mechanism / bridge / storyline evidence provider
2. 让 `openclaw-research` 成为：
   - durable orchestration layer
   - ideation/story/review contract manager
   - plan/code/experiment/write/review 的强约束执行层
3. 让 EvoScientist 的方法论继续承担：
   - 创新点中间产物流
   - 写作故事线结构化
   - reviewer 对抗式回压

这样做的结果是：

- 不会把图智能重复实现两遍
- 不会继续把所有逻辑塞回 workflow 文件
- 可以让当前系统从“强 workflow + 部分强研究智能”，向“高质量半自治科研系统”继续逼近

如果目标是“端到端高质量自动化科研”，那么这条路径是正确的；  
但它的前提不是继续堆更多 prompt，而是**把 PaperNexus 的图智能与 openclaw-research 的 contract/workflow 能力真正分层接起来**。
