# 基于 EvoScientist / EvoSkills 的创新设计与论文故事线增强 Workflow 设计稿

**状态：** 草稿  
**日期：** 2026-04-02  
**作者：** Codex  
**范围：** `openclaw-research` 的 `idea / plan / code / experiment / analyze / review / write` 阶段，Researcher / Orchestrator / Coder / Reviewer / Academic Writer 相关技能与 durable workflow state

---

## 1. 背景

当前 `openclaw-research` 已经具备以下优势：

- 明确的阶段状态机
- durable 的 `PROJECT_MANIFEST.json` / `TRACK_REGISTRY.json` / `EXPERIMENT_LEDGER.json`
- graph-grounded brainstorm 与 PaperNexus 证据链
- baseline-aware 的 code review 与 experiment gate
- writer / reviewer 的基本 claim-evidence 约束

但与 EvoScientist / EvoSkills 相比，当前系统仍有两个结构性缺口：

1. **创新点提出的中间产物流不够完整**
   现在更多是 `graph-grounded brainstorm -> idea report -> plan`，但缺少将灵感逐步收敛成“可比较、可淘汰、可沉淀”的 durable 中间层：
   - novelty tree
   - challenge-insight tree
   - established-solution check
   - cross-domain transfer 草图
   - problem decomposition
   - tournament candidate pool
   - multi-axis ranking
   - top-3 direction summary
   - research proposal

2. **论文故事线与代码/实验之间仍然耦合不够紧**
   当前虽然有 `PAPER_PLAN.md`、`STORYLINE_SKETCH.md`、claim policy，但还没有把下面这些产物做成强制合同：
   - task -> challenge -> insight -> contribution -> advantage 的 story spine
   - pipeline figure sketch
   - module motivation mapping
   - claim-to-experiment mapping
   - fallback narrative
   - rejection-risk table
   - reject-first simulation
   - unsupported claim audit

因此，当前框架仍容易出现：

- 创新点“像 brainstorm 结果”，但不是可审计的研究方向
- 代码实现和创新点之间缺少完整逻辑链
- 实验设计不能逐步验证创新子点
- 写作阶段故事线靠临时整理，不是被 workflow 强制组织出来
- reviewer 能指出问题，但系统没有提前把故事脆弱点结构化下来

---

## 2. 设计目标

本设计的目标是，在不推翻现有状态机的前提下，把 EvoScientist / EvoSkills 中最有价值的流程控制能力接入 `openclaw-research`。

### 2.1 核心目标

1. 让创新点从“论文阅读后的直觉”升级为“有 gap、solution、ranking、proposal 的 durable 研究方向”
2. 让论文故事线从“写作阶段再整理”升级为“由 claim-evidence 合同驱动的结构化叙事”
3. 让代码、实验、分析、写作围绕同一个 innovation/story contract 闭环
4. 充分利用现有 PaperNexus 图谱，把 graph 变成：
   - ideation 的 grounding 层
   - challenge-insight tree 的证据层
   - story spine 的 related-work / evidence 层
5. 保留现有 durable workflow state、slash commands、PaperNexus wrapper、runtime queue、review gate、monitoring 能力

### 2.2 目标结果

理想状态下，一个项目在 `graph_build -> idea -> plan -> code -> experiment -> analyze -> review -> write` 之间，必须生成并维护两套核心合同：

- **Ideation Contract**：创新方向的逻辑链与证据链
- **Paper Story Contract**：论文叙事的逻辑链与证据链

这两套合同要变成 workflow 的事实源，而不是聊天里的临时描述。

---

## 3. 非目标

本设计不做以下事情：

1. 不改写现有顶层阶段顺序
2. 不抛弃当前的 graph-grounded brainstorm provider 体系
3. 不把系统重写成纯 EvoScientist 式 prompt-driven runtime
4. 不让 `idea` 阶段直接替代 `plan / code / experiment / analyze`
5. 不让论文写作完全变成“一个大 prompt 生成稿子”

一句话概括：

**保留 `openclaw-research` 的强状态机与 durable state，把 EvoScientist 的中间层方法论接进来。**

---

## 4. 总体设计

### 4.1 保留的顶层阶段

顶层阶段继续保持：

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit`

其中：

- `graph_build` 已负责 `uploading / verifying / brainstorm_refresh`
- `idea` 继续是创新方向收敛阶段
- `write` 继续是成稿阶段

### 4.2 新增的中间合同

本设计新增两套 durable 合同，再辅以一套 review pressure packet。

#### A. `ideation_contract`

服务于 `graph_build / frontier_mapping / idea / plan`

目的：

- 让创新点从 graph-grounded brainstorm 提升为可比较、可淘汰、可沉淀的研究方向

#### B. `paper_story_state`

服务于 `plan / code / experiment / analyze / write`

目的：

- 让故事线在写作前就被 formalize，并与代码和实验绑定

#### C. `review_pressure_packet`

服务于 `review / write`

目的：

- 在正式论文写作前，用 reject-first / novelty-attack / unsupported-claim audit 提前对抗式压力测试

### 4.3 为什么是“两个主合同 + 一个评审包”

这样设计有三个好处：

1. **复杂度可控**
   ideation 和 story 是两个最强的 durable 核心；review pressure 更像 story 合同上的 stress test，而不是第三个大状态机。

2. **和现有阶段最贴合**
   - `idea` 阶段天然消费 ideation contract
   - `write` 阶段天然消费 story contract
   - `review` 阶段天然消费 review pressure packet

3. **便于复用现有 graph / experiment / review 能力**
   当前 graph、innovation reflection、writer/reviewer runtime 都能直接成为这三者的底座。

4. **避免重复 memory 体系**
   不再单独引入一套新的“ideation memory”存储，而是复用现有 graph-backed durable structures：
   - `brainstorm_cycle.working_memory_path`
   - `brainstorm_cycle.reflection_chain_path`
   - `brainstorm_cycle.storyline_brief_path`
   - `innovation_reflection`
   - `TRACK_REGISTRY.json` 中每个 track 的 reasoning / synthesis / evidence 指针
   - 项目级 graph packets 与 frontier files

---

## 5. Ideation Contract 设计

### 5.1 核心职责

`ideation_contract` 要回答这些问题：

- 我们长期研究目标是什么？
- 当前问题空间里还有哪些真实 gap？
- 哪些 gap 已经被成熟方案覆盖，不值得继续？
- 候选方向有哪些？
- 它们在 novelty / feasibility / relevance / clarity 上分别如何？
- 为什么当前冠军方向值得进入计划和代码阶段？
- top-3 中哪些值得保留到现有 graph-backed memory 结构，哪些应显式淘汰？

### 5.2 建议持久化字段

建议把 `ideation_contract` 放入 `PROJECT_MANIFEST.json`，字段如下：

```json
{
  "ideation_contract": {
    "status": "missing",
    "contract_version": 1,
    "long_term_goal": null,
    "problem_scope": null,
    "basis_stage": "graph_build",
    "graph_basis_paths": {
      "papernexus_status_path": "graph/PAPERNEXUS_STATUS.json",
      "frontier_report": null,
      "anchor_index_path": "graph/ANCHOR_INDEX.md",
      "limitation_frontier_path": "graph/LIMITATION_FRONTIER.md",
      "contradiction_frontier_path": "graph/CONTRADICTION_FRONTIER.md",
      "transfer_frontier_path": "graph/TRANSFER_FRONTIER.md",
      "composition_frontier_path": "graph/COMPOSITION_FRONTIER.md",
      "topic_summary_path": null,
      "logic_chain_path": null,
      "evidence_chain_path": null,
      "storyline_brief_path": null
    },
    "novelty_tree_path": "researcher/ideation/NOVELTY_TREE.md",
    "challenge_insight_tree_path": "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    "solution_check_path": "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
    "cross_domain_transfer_path": "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    "problem_decomposition_path": "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    "candidate_pool_path": "researcher/ideation/CANDIDATE_POOL.json",
    "tournament_scoreboard_path": "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    "top3_summary_path": "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    "research_proposal_path": "researcher/ideation/RESEARCH_PROPOSAL.md",
    "selected_direction_id": null,
    "selected_track_id": null,
    "pending_reason": null,
    "last_updated_at": null
  }
}
```

另外建议为这三类图生 ideation 产物补一组摘要索引字段，避免 tree 文档只能靠自由文本维持：

```json
{
  "graph_ideation_indices": {
    "status": "missing",
    "novelty_candidate_clusters": [],
    "challenge_clusters": [],
    "insight_clusters": [],
    "occupied_solution_zones": [],
    "transfer_bridges": [],
    "last_refresh_at": null
  }
}
```

这些索引不是为了替代文档，而是为了让 novelty tree、challenge-insight tree、solution check 的核心判断先经过图结构整理，再交给 agent 写成可读结论。
它们也应被视为现有 graph-backed working memory 的一部分，而不是一套独立的新 memory。

### 5.3 必须产出的中间文档

#### `NOVELTY_TREE.md`

结构建议：

- 按 milestone task / representative pipeline / novel module 组织
- 每个分支列出：
  - 已有主流路线
  - 仍为空白的区域
  - 空白是否真实、还是只是实现未跟上

**graph-native 改进要求：**

- novelty tree 不能从空白文本开始写，必须先由共享图生成候选簇
- 候选簇至少要综合：
  - `FRONTIER_REPORT.md`
  - `ANCHOR_INDEX.md`
  - `brainstorm_cycle.logic_chain_path`
  - `brainstorm_cycle.evidence_chain_path`
  - `brainstorm_cycle.storyline_brief_path`
- 每个 novelty branch 都必须带：
  - `anchor papers`
  - `baseline family`
  - `challenge tag`
  - `novel module / formulation candidate`
  - `occupied-or-open` 判断

建议的 workflow 逻辑：

1. 从 frontier anchors 中先抽出高密度 baseline families
2. 用 limitation / contradiction / transfer / composition 四类 frontier 把这些 family 切成候选 novelty zones
3. 用 typed chains 判断哪些 zone 只是“旧方法换数据/换名词”，哪些 zone 真正跨越了 challenge 或 formulation
4. 只有最后一步才写成人类可读的 novelty tree

这样 `NOVELTY_TREE.md` 记录的是“图结构归并后的研究空白”，而不是 agent 的自由发挥摘要。

#### `CHALLENGE_INSIGHT_TREE.md`

结构建议：

- 按 challenge -> existing insights -> unresolved tension 组织
- 必须标注哪些 insight 来自 graph 中的哪些 paper cluster / evidence chain

**graph-native 改进要求：**

- challenge 节点优先来自：
  - limitation frontier
  - contradiction frontier
  - `FAILS_UNDER` / `HAS_LIMITATION` / `SUPPORTED_BY` 风格证据模式
- insight 节点优先来自：
  - transfer frontier
  - composition frontier
  - typed research chain 中的可迁移机制
- tree 中每一条 challenge -> insight 关系，都必须记录：
  - 支撑 challenge 的 anchor cluster
  - 对应 insight 的 origin cluster
  - 连接它们的 transfer / compatibility / evidence reason

建议的 workflow 逻辑：

1. 先从 frontier files 与 chain bundle 中抽 challenge clusters
2. 再从 transfer / composition / ideas / context / impact 查询结果中抽 insight clusters
3. 最后只保留“challenge 明确、insight 真实存在、两者之间有合理桥接”的 pair

这样 `CHALLENGE_INSIGHT_TREE.md` 不再只是“困难列表 + 灵感列表”，而是被图结构连接起来的问题-解法树。

#### `WELL_ESTABLISHED_SOLUTION_CHECK.md`

用途：

- 防止系统在成熟赛道上做边际修补
- 对每个候选问题回答：
  - 是否已有 well-established solution
  - 是否还存在真实 tradeoff / fragility / generalization gap / setting mismatch

**graph-native 改进要求：**

- 这一步不能只靠文本搜索“有没有人做过”，而要显式读取图中的 solution maturity 迹象
- 至少检查：
  - 同一 baseline family 在 graph 中的密度
  - 是否存在稳定的“主方法族 + 小修补”模式
  - 是否还有 unresolved contradiction / limitation cluster
  - 是否还存在 benchmark / setting / robustness 的断层

建议的 workflow 逻辑：

1. 对每个候选方向回查 novelty tree 对应的 anchor zone
2. 统计该 zone 的方法家族密度、近期演化、 limitation/contradiction 是否仍活跃
3. 如果图显示“主要问题已被成熟方案覆盖，近作只是在做轻量微调”，则标记为 `occupied`
4. 如果图显示“虽然看起来已有强方法，但仍有 setting mismatch / robustness gap / contradiction unresolved”，则标记为 `open_with_constraints`

这样 `WELL_ESTABLISHED_SOLUTION_CHECK.md` 会更像基于图成熟度分析的占坑判断，而不是靠 agent 主观说“这个方向可能还行”。

#### `CROSS_DOMAIN_TRANSFER.md`

用途：

- 强制引入跨领域迁移视角
- 不允许把“已有模块拼接”误写成创新

#### `PROBLEM_DECOMPOSITION.md`

用途：

- 把大问题拆成能被单独验证的 innovation sub-points

#### `CANDIDATE_POOL.json`

要求：

- 支持 tree-based candidate expansion
- 每个候选必须至少带：
  - `id`
  - `parent_id`
  - `formulation`
  - `novelty_hypothesis`
  - `feasibility_risk`
  - `baseline_relation`
  - `status`

#### `TOURNAMENT_SCOREBOARD.json`

要求：

- 记录 propose -> review -> refine
- 至少四个轴：
  - novelty
  - feasibility
  - relevance
  - clarity
- 保留 pairwise / Elo 风格排序结果或等价 ranking history

#### `TOP3_DIRECTION_SUMMARY.md`

要求：

- 不只保留冠军
- top-3 都要写回现有的 graph-backed memory 结构，避免重复踩坑：
  - `brainstorm_cycle.working_memory`
  - `brainstorm_cycle.reflection_chain`
  - `innovation_reflection`
  - `TRACK_REGISTRY.json` 的 parked / killed / reasoning pointers

#### `RESEARCH_PROPOSAL.md`

要求：

- background
- related work gap
- method hypothesis
- experiment plan
- expected results
- risks and mitigations

### 5.4 与现有 graph 的结合方式

现有 PaperNexus 图谱不能只作为“查几篇论文”的工具，而要成为 ideation contract 的 grounding layer。

具体要求：

1. novelty tree 必须引用 graph 聚类、question packet、logic chain、evidence chain
2. challenge-insight tree 必须标出 graph 中支持 challenge 的 paper neighborhoods
3. solution check 必须优先看 graph 中 closest prior work 的密度与成熟度
4. cross-domain transfer 必须优先从图里识别“异域但相关的结构性技术”
5. tournament 候选必须保留其 graph grounding 证据路径

### 5.4.1 复用现有 graph-backed memory，而不是新建一套 ideation memory

当前仓库里已经存在多种适合承载研究记忆的 durable 结构：

- `brainstorm_cycle.working_memory_path`
- `brainstorm_cycle.reflection_chain_path`
- `brainstorm_cycle.storyline_brief_path`
- `innovation_reflection`
- `TRACK_REGISTRY.json` 的 reasoning packet / synthesis packet / evidence pointers
- `FRONTIER_REPORT.md` 与 `graph/*.md` frontier files

因此本设计明确要求：

1. 不新增独立的 `ideation-memory.md` 作为新的事实源
2. top-3、do-not-repeat、failed direction、transferable lessons 应优先写回：
   - `brainstorm_cycle.working_memory`
   - `brainstorm_cycle.reflection_chain`
   - `innovation_reflection`
   - `TRACK_REGISTRY.json`
3. 新增的 `GRAPH_IDEATION_PACKET.json` 与 `graph_ideation_indices` 也属于 graph-native memory layer，而不是新的平行记忆系统

这样做的原因是：

- 避免 memory 分叉
- 避免“文档里说一个版本，图里记一个版本”
- 让 ideation 和 story 都建立在现有 graph / chain / reflection 事实上

### 5.5 三个关键产物的 graph-first 生成顺序

为了让 `novelty tree / challenge-insight tree / solution check` 真正用上现有图，本设计建议它们按下面顺序生成：

```text
graph_build/brainstorm_refresh
  -> frontier_mapping
  -> graph basis packet ready
  -> challenge cluster extraction
  -> insight cluster extraction
  -> novelty zone synthesis
  -> well-established solution check
  -> candidate pool + tournament
```

顺序原因：

1. **先 challenge / insight，再 novelty**
   因为 novelty 不是凭空新，而是“当前 challenge 仍未被已有 insight 真正解决”的结构化空白。

2. **先 novelty，再 solution check**
   因为要先定义候选 zone，才能判断这个 zone 是 open 还是 occupied。

3. **先 solution check，再 tournament**
   因为被判定为 `occupied` 的方向，不能继续和开放方向一起混进 ranking。

### 5.6 推荐的 graph basis packet

为了减少 agent 每次自己拼上下文，建议 `graph_build/brainstorm_refresh` 或 `frontier_mapping` 最终产出一个项目级 basis packet，例如：

`{PROJ}/researcher/ideation/GRAPH_IDEATION_PACKET.json`

建议字段：

```json
{
  "project_id": "gcd-confirmation-bias-mitigation",
  "basis_stage": "graph_build",
  "frontier_files": [
    "graph/LIMITATION_FRONTIER.md",
    "graph/CONTRADICTION_FRONTIER.md",
    "graph/TRANSFER_FRONTIER.md",
    "graph/COMPOSITION_FRONTIER.md"
  ],
  "chain_bundle": {
    "logic_chain_path": "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
    "evidence_chain_path": "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
    "storyline_brief_path": "researcher/brainstorm-cycle/STORYLINE_BRIEF.json"
  },
  "challenge_clusters": [],
  "insight_clusters": [],
  "novelty_zones": [],
  "occupied_zones": [],
  "transfer_bridges": []
}
```

后续 novelty tree / challenge-insight tree / solution check 应优先读取这个 packet，而不是各自重新从零扫图。

---

## 6. Paper Story Contract 设计

### 6.1 核心职责

`paper_story_state` 要回答这些问题：

- 我们到底解决了哪个具体 challenge？
- insight 是什么？
- contribution 有哪 2-3 个可验证点？
- 每个 contribution 带来什么 advantage？
- 每个 claim 由哪个实验、图、表支撑？
- 如果主叙事失败，fallback narrative 是什么？
- reviewer 最容易在哪些地方 reject？

### 6.2 建议持久化字段

建议新增：

```json
{
  "paper_story_state": {
    "status": "missing",
    "contract_version": 1,
    "task_summary_path": "academic_writer/story/TASK_SUMMARY.md",
    "challenge_statement_path": "academic_writer/story/CHALLENGE_STATEMENT.md",
    "insight_summary_path": "academic_writer/story/INSIGHT_SUMMARY.md",
    "contribution_map_path": "academic_writer/story/CONTRIBUTION_MAP.md",
    "advantage_map_path": "academic_writer/story/ADVANTAGE_MAP.md",
    "story_spine_path": "academic_writer/story/STORY_SPINE.md",
    "pipeline_figure_sketch_path": "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
    "module_motivation_map_path": "academic_writer/story/MODULE_MOTIVATION_MAP.md",
    "claim_to_experiment_map_path": "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    "fallback_narrative_path": "academic_writer/story/FALLBACK_NARRATIVE.md",
    "rejection_risk_table_path": "academic_writer/story/REJECTION_RISK_TABLE.md",
    "storyline_source_track_id": null,
    "pending_reason": null,
    "last_updated_at": null
  }
}
```

### 6.3 核心故事链

故事链固定采用：

`task -> challenge -> insight -> contribution -> advantage`

并要求反向和正向都能成立：

- 反向：
  - 我们真正解决的 challenge 是什么？
  - 这为什么需要这个 insight？
  - insight 如何落到模块与贡献？
  - 贡献为什么带来 advantage？
- 正向：
  - 任务背景
  - 前人方法与不足
  - challenge
  - 我们的 insight / contribution
  - resulting advantage

### 6.4 必须产出的中间文档

#### `PIPELINE_FIGURE_SKETCH.md`

这不是装饰，而是 story skeleton：

- novel modules
- information flow
- each module's purpose
- which challenge each module addresses

#### `MODULE_MOTIVATION_MAP.md`

要求每个模块同时回答：

- 设计是什么
- motivation 是什么
- advantage 是什么

#### `CLAIM_TO_EXPERIMENT_MAP.md`

要求每个 headline claim 明确链接到：

- 哪个 experiment
- 哪张图 / 表
- 哪个 baseline comparison
- 哪个 ablation / robustness / failure case

#### `FALLBACK_NARRATIVE.md`

要求预先写出：

- 如果主叙事未被 strongest evidence 支撑，次叙事如何切换
- 哪些 claim 应该收缩
- 哪些 contribution 仍可保留

#### `REJECTION_RISK_TABLE.md`

要求列出：

- 风险点
- reviewer 可能怎样 reject
- 当前证据是否足够
- 需要的补强实验 / 写作策略

### 6.5 与代码和实验的绑定

`paper_story_state` 不能只存在于写作阶段。

它必须反向约束 `code / experiment / analyze`：

1. `code` 阶段必须读取 `claim_to_experiment_map`
2. 每个 innovation sub-point 都必须在实验设计里有对应验证路径
3. `analyze` 阶段必须回写哪张图/表支撑哪个 claim
4. `write` 阶段禁止跳过没有证据支撑的强 claim

---

## 7. Review Pressure Packet 设计

### 7.1 定位

这是 `paper_story_state` 的对抗式压力测试，而不是独立顶层阶段。

建议以 durable packet 形式落地：

```json
{
  "review_pressure_packet": {
    "status": "missing",
    "reject_first_review_path": "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
    "novelty_attack_path": "reviewer/story-pressure/NOVELTY_ATTACK.md",
    "unsupported_claim_audit_path": "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    "reverse_outline_path": "reviewer/story-pressure/REVERSE_OUTLINE.md",
    "figure_table_qc_path": "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    "limitation_audit_path": "reviewer/story-pressure/LIMITATION_AUDIT.md",
    "status_reason": null,
    "last_updated_at": null
  }
}
```

### 7.2 目标

把 EvoSkills `paper-review` 中最重要的 adversarial review 机制前置到 workflow：

- reject-first simulation
- attack novelty
- delete unsupported claim
- reverse outlining
- figure/table quality checklist
- limitation check

这样写作阶段不是“先写完再被 reviewer 拆”，而是“先经受拆解，再写成更稳的稿子”。

---

## 8. 阶段级 Workflow 改造

## 8.1 `graph_build`

当前已拆成：

- `graph_build/uploading`
- `graph_build/verifying`
- `graph_build/brainstorm_refresh`

在本设计中，`graph_build/brainstorm_refresh` 的完成条件要升级：

1. `brainstorm_cycle.status` ready
2. `brainstorm_cycle` 产出完整 logic/evidence/storyline briefs
3. `ideation_contract.graph_basis_paths` 能够引用这些产物

换句话说：

`graph_build` 不再只是“图 ready”，还要为 ideation contract 准备 grounding packet。

## 8.2 `frontier_mapping`

改为 `ideation_contract` 的准备阶段，而不是直接通向 proposal。

产出：

- graph-grounded frontier report
- long-tail challenge list
- closest-prior-work neighborhoods

这些会进入 novelty tree / challenge-insight tree。

## 8.3 `idea`

这是最大改动点。

`idea` 阶段改成固定的内部顺序：

1. wide literature and graph sweep
2. reflection after each search round，并回写到现有 graph-backed memory
3. novelty tree
4. challenge-insight tree
5. well-established solution check
6. cross-domain transfer sketch
7. problem decomposition
8. candidate pool expansion
9. tournament ranking
10. top-3 summary，并回写到现有 graph-backed memory / track state
11. champion research proposal

只有 `ideation_contract.status = ready`，才允许进入 `plan`。

## 8.4 `plan`

`plan` 阶段不再只读取 `IDEA_REPORT.md`，而是必须读取：

- `RESEARCH_PROPOSAL.md`
- `TOP3_DIRECTION_SUMMARY.md`
- `PROBLEM_DECOMPOSITION.md`
- `CLAIM_TO_EXPERIMENT_MAP.md` 的初版约束

目标：

- 把 ideation champion 变成 baseline-aware、metric-aware、ablation-aware 的执行计划

## 8.5 `code`

`code` 阶段必须显式引用：

- innovation points
- baseline reference
- problem decomposition
- claim-to-experiment mapping

Coder 不再只对 `PLAN.md` 负责，而是也对 `paper_story_state` 的实验支撑结构负责。

## 8.6 `experiment`

`experiment` 阶段除了当前 monitor / ledger / experiment_search，还要承担：

- 验证 innovation sub-points
- 反馈哪些 claim 得到支撑、哪些还未得到支撑
- 给 `paper_story_state` 回写证据成熟度

## 8.7 `analyze`

`analyze` 阶段必须把结果整理成：

- 哪个 claim 被支撑
- 哪个 claim 仍弱
- 哪个模块 advantage 被证实
- 哪些 failure cases / boundary cases 需要进入 limitation

## 8.8 `review`

`review` 阶段新增 review pressure packet 的硬要求。

如果下面任何一个缺失，则不能进入稳定写作：

- reject-first review
- unsupported-claim audit
- novelty attack
- reverse outline
- limitation audit

## 8.9 `write`

`write` 阶段不再只依赖 `PAPER_PLAN.md + STORYLINE_SKETCH.md`。

还必须要求：

- `paper_story_state.status = ready`
- claim-to-experiment map ready
- fallback narrative ready
- rejection risk table ready
- review pressure packet ready

然后 Academic Writer 再按 section order 展开。

---

## 9. Agent / Skill 层面的改造建议

### 9.1 Researcher

Researcher 要新增或强化以下职责：

- 用 graph 组织 novelty tree / challenge-insight tree
- 每轮搜索后显式反思
- 维护 top-3 的 graph-backed memory 与 track state，而不是新建独立 ideation memory
- 维护 research proposal

需要改的文件：

- `skills/researcher/idea-phase/SKILL.md`
- `skills/researcher/frontier-mapping/SKILL.md`
- `skills/researcher/innovation-reflection/SKILL.md`
- `agents/researcher/AGENTS.md`

### 9.2 Orchestrator

Orchestrator 要新增：

- ideation contract gate
- proposal-to-plan translation
- baseline / metric / validation ladder binding

需要改的文件：

- `skills/orchestrator/plan-research/SKILL.md`
- `agents/orchestrator/AGENTS.md`

### 9.3 Coder

Coder 要新增：

- 实现时必须引用 innovation sub-points
- 代码包必须对应 claim-to-experiment mapping
- 不能脱离 baseline protocol

需要改的文件：

- `skills/coder/implement-experiment/SKILL.md`
- `agents/coder/AGENTS.md`
- `agents/coder/SOUL.md`

### 9.4 Academic Writer

Academic Writer 要新增：

- 先 story spine，再 sections
- pipeline figure sketch 优先于长篇 prose
- module motivation mapping
- fallback narrative
- rejection-risk driven story tightening

需要改的文件：

- `skills/academic_writer/paper-plan/SKILL.md`
- `skills/academic_writer/paper-write/SKILL.md`
- `agents/academic_writer/AGENTS.md`

### 9.5 Reviewer

Reviewer 要新增：

- reject-first simulation
- novelty attack
- unsupported claim deletion
- reverse outlining
- figure/table QC

需要改的文件：

- `skills/reviewer/review-phase/SKILL.md`
- `agents/reviewer/AGENTS.md`

---

## 10. Durable State 与 Tooling 设计建议

### 10.1 Manifest 扩展

建议在 `PROJECT_MANIFEST.json` 中新增：

- `ideation_contract`
- `paper_story_state`
- `review_pressure_packet`

### 10.2 Workflow Tools

建议新增：

- `research_workflow.get_ideation_contract`
- `research_workflow.set_ideation_contract`
- `research_workflow.get_paper_story_state`
- `research_workflow.set_paper_story_state`
- `research_workflow.get_review_pressure_packet`
- `research_workflow.set_review_pressure_packet`

### 10.3 Status 面

`/workflow-status` 需要增加：

- ideation contract status
- selected direction / top-3 graph-memory status
- paper story status
- claim-to-experiment map status
- review pressure packet status

这样用户能一眼看出：

- 是创新逻辑链没闭环
- 还是故事线没闭环
- 还是 reviewer 压力测试没闭环

---

## 11. 写作流程如何贴近 EvoScientist

为了贴近 EvoScientist / EvoSkills，本设计要求写作顺序显式调整为：

1. 确认 story spine
2. 先画 pipeline figure sketch
3. 写 module motivation mapping
4. 写 claim-to-experiment mapping
5. 写 fallback narrative
6. 写 rejection-risk table
7. 写 Method
8. 写 Experiments
9. 写 Related Work
10. 写 Introduction / Abstract / Title
11. 做 reject-first review / reverse outline / unsupported claim audit

这条顺序的核心是：

- 图与故事先于 prose
- claim 先于 wording
- evidence 先于夸张措辞
- risk table 先于投稿自信

---

## 12. 基于图谱的进一步优化

用户已经有论文分析图谱，因此本设计要求把 graph 用到比现在更深的层级。

### 12.1 Ideation 层

- 用 graph cluster 构建 novelty tree
- 用 question packet / evidence chain 构建 challenge-insight tree
- 用 graph 中 closest baselines 来做 solution maturity check
- 用 typed research chains 找 cross-domain transfer seeds

### 12.2 Story 层

- 用 graph-grounded storyline brief 支撑 task-gap-method arc
- 用 related-work neighborhoods 支撑“为什么读者自然期待这个方法”
- 用 graph-derived evidence chain 帮助 claim-to-experiment mapping

### 12.3 Review 层

- 用 graph 检查 novelty claim 是否 overstated
- 用 graph 中的 strong prior art 作为 novelty attack 的素材

---

## 13. 风险与缓解

### 13.1 风险：流程变重

缓解：

- 用 durable contract 而不是新增很多顶层阶段
- top-level stages 保持不变

### 13.2 风险：Researcher / Writer 负担上升

缓解：

- graph 与 wrapper 提供 grounding，减少纯人工整理
- 让中间产物可逐步生成，不要求一次写完

### 13.3 风险：状态过多、难维护

缓解：

- 只新增两套主合同和一套 review pressure packet
- 保持和现有 `brainstorm_cycle` / `writing_contract` / `innovation_reflection` / `TRACK_REGISTRY` / frontier files 协同
- 尽量复用现有 graph-backed memory，不再新建独立 ideation memory

---

## 14. 与用户需求的覆盖核对

本节逐条核对用户上面长说明中的关键点，确认设计是否覆盖。

### 14.1 创新点设计部分

| 用户提出的点 | 本设计是否覆盖 | 对应机制 |
| --- | --- | --- |
| `research-ideation -> idea-tournament -> paper-planning -> experiment-pipeline` 固定顺序 | 是 | `idea -> plan -> code -> experiment` 中引入 `ideation_contract` 和 `paper_story_state`，并在 `idea` 内固定内部顺序 |
| 宽搜文献、每轮搜索后反思、补 gap、再收窄问题 | 是 | `idea` 阶段内部顺序第 1-2 步，Researcher 每轮搜索后反思并更新 contract |
| identify gaps / 阶段反思 / memory 读取与更新 | 是 | novelty tree、challenge-insight tree、top-3 summary、innovation reflection、brainstorm_cycle working_memory / reflection_chain、TRACK_REGISTRY |
| novelty tree | 是 | `NOVELTY_TREE.md` |
| challenge-insight tree | 是 | `CHALLENGE_INSIGHT_TREE.md` |
| well-established solution check | 是 | `WELL_ESTABLISHED_SOLUTION_CHECK.md` |
| cross-domain transfer | 是 | `CROSS_DOMAIN_TRANSFER.md` |
| problem decomposition | 是 | `PROBLEM_DECOMPOSITION.md` |
| candidate expansion / propose-review-refine | 是 | `CANDIDATE_POOL.json` + `TOURNAMENT_SCOREBOARD.json` |
| 不允许过早收窄 | 是 | candidate pool 与 tournament gate 在 ideation contract ready 前不放行 |
| novelty / feasibility / relevance / clarity 四维排序 | 是 | scoreboard 的四轴硬要求 |
| 冠军扩展成完整 proposal | 是 | `RESEARCH_PROPOSAL.md` |
| top-3 方向写回 memory | 是 | `TOP3_DIRECTION_SUMMARY.md` + 现有 graph-backed memory（`working_memory` / `reflection_chain` / `TRACK_REGISTRY` / `innovation_reflection`） |
| 中间产物流可审计 | 是 | 合同中的所有 durable artifact |

### 14.2 论文故事线部分

| 用户提出的点 | 本设计是否覆盖 | 对应机制 |
| --- | --- | --- |
| 写作与实验强绑定 | 是 | `paper_story_state` 反向约束 `code / experiment / analyze / write` |
| problem/challenge/insight/contribution/advantage 的 story formalization | 是 | `story spine` 固定结构 |
| reverse engineering challenge / contribution / advantage | 是 | story spine 反向与正向都要成立 |
| pipeline figure sketch 优先 | 是 | `PIPELINE_FIGURE_SKETCH.md` 成为必需产物 |
| module motivation mapping | 是 | `MODULE_MOTIVATION_MAP.md` |
| claim-to-experiment mapping | 是 | `CLAIM_TO_EXPERIMENT_MAP.md` |
| fallback narrative | 是 | `FALLBACK_NARRATIVE.md` |
| rejection-risk table | 是 | `REJECTION_RISK_TABLE.md` |
| Method / Experiments / Related Work / Abstract / Title 的顺序控制 | 是 | 写作顺序第 7-10 步 |
| claim 必须锚到图表/实验 | 是 | claim-to-experiment map + analyze stage 回写 |
| 每个模块都要交代 design / motivation / advantage | 是 | module motivation mapping 硬要求 |
| Experiments 要证明方法更好、模块有效、边界在哪 | 是 | claim-to-experiment map + analyze summary + limitation audit |
| Related Work 为 gap 服务而不是 catalog | 是 | story spine 与 writer contract 强制它服务于 challenge |
| reject-first simulation | 是 | review pressure packet |
| attack novelty | 是 | `NOVELTY_ATTACK.md` |
| delete unsupported claim | 是 | `UNSUPPORTED_CLAIM_AUDIT.md` |
| reverse outlining | 是 | `REVERSE_OUTLINE.md` |
| figure/table 质量清单 | 是 | `FIGURE_TABLE_QC.md` |
| limitation 检查 | 是 | `LIMITATION_AUDIT.md` |

### 14.3 图谱利用部分

| 用户提出的点 | 本设计是否覆盖 | 对应机制 |
| --- | --- | --- |
| 已有论文分析图可进一步优化 ideation | 是 | graph 作为 novelty/challenge/story grounding layer |
| 用图支撑 evidence chain 和 reasoning chain | 是 | ideation contract 与 paper story state 都要求 graph basis paths |
| 用图帮助提出更有逻辑性的创新点 | 是 | frontier / evidence / closest prior neighborhoods 进入 ideation contract |

结论：

**用户在长说明中强调的关键点，已全部纳入本设计。**

未直接照搬的地方只有两点：

1. 没有把顶层阶段名改成 EvoScientist 的命名方式  
   原因：需要保持与当前 durable state 和 auto workflow 兼容。
2. 没有把所有写作步骤都硬编码成新的顶层 stage  
   原因：采用“合同 + gate”的方式能在保持当前框架稳定的同时达到近似效果。

---

## 15. 推荐实施顺序

1. 扩展 manifest 与 workflow tool state
2. 先把 `idea` 阶段接入 `ideation_contract`
3. 再把 `write` 阶段接入 `paper_story_state`
4. 再把 `review` 阶段接入 `review_pressure_packet`
5. 最后更新 skills / agents / `/workflow-status`

---

## 16. 最终结论

如果要让当前框架真正具备 EvoScientist 那种：

- 创新点提出的逻辑性
- 思维链和证据链的完整性
- 从 ideation 到 code 到 write 的闭环
- reviewer 视角前置压测

最合适的做法不是推翻现有 workflow，而是：

**保留当前状态机，把 EvoScientist 式的方法论下沉为 durable contracts、gate 和中间产物。**

这会让 `openclaw-research` 继续保持：

- 可恢复
- 可审计
- 可自动推进
- graph-grounded

同时补上当前最缺的两件事：

- 创新点设计的严密性
- 论文故事线的结构化强约束
