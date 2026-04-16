# 顶会 / 顶刊写作流程差距闭环改进方案

本文对照 Obsidian 写作教程：

`/Users/iranb/Library/Mobile Documents/iCloud~md~obsidian/Documents/001-WIKI/entities/paper-writting/01-顶会顶刊论文写作总教程.md`

目标是把教程里的写作流程，落成 `openclaw-research` workflow 中可执行、可审计、可阻塞、可恢复的控制面。

当前版本特别聚焦：

- 初稿已经成型之后的后续优化环节
- 多创新点如何整合成统一故事线
- 当 graph / literature 素材不足以完成整合时，如何允许额外搜索

它不是要把所有写作动作都提前到“动笔之前”，而是要为 draft 完成后的结构重整、补证据、补叙事、补投稿质量建立稳定闭环。

本文不是泛泛的写作建议，而是下一轮 runtime / hooks / materializer / tests 的实现方案。

---

## 0. 总体判断

当前框架已经比较强地覆盖了写作后半段：

- `writing_contract` 定义 section / template / KG storyline / proof appendix 等合同。
- `writing_session` 追踪 section packets、stale section、ready-for-submit。
- `write_package` 约束 claim-evidence、narrative report、track verdicts、unsupported claims、baseline / ablation / evaluation summaries。
- `graph_guided_writing` 约束 headline claim 的 graph evidence coverage。
- `citation_integrity` / `review_issue_tracker` / `paper_qc` / `figure_qc` 约束提交前完整性。
- `FIGURE_REGISTRY.json` / `TABLE_REGISTRY.json` / `FIGURE_TABLE_ALIGNMENT.md` 约束图表预算。
- `workflow_hooks` 负责 reviewer 语义审核。

但教程强调的写作流程，核心不是“写完后检查”，而是：

```text
主张 -> 证据 -> 图表 -> Results 顺序 -> 摘要 -> 引言 -> 正文 -> 终版修稿
```

当前系统还缺少两个关键层面：

1. 从空白到初稿前的顶会级写作工作台。
2. 初稿形成后，把多个有效 innovation point 真正整合成统一故事线的优化闭环。

因此本方案的核心是：

1. 新增 pre-draft workbench，把教程里的最短可执行版做成 durable contract。
2. 把标题、摘要、引言、Results、Methods、Related Work、语言低摩擦、venue-specific 投稿要求做成 hooks / gates。
3. 新增 draft-post-optimization lane，把 innovation synthesis、story-gap search、rebuttal/change tracking、memorability 放到 writer 初稿成型之后。
4. 保持现有 `workflow-hooks` 架构，不再新增平行 reviewer 系统。
5. 默认先使用现有 `file_audit` hook type，必要时新增 deterministic materializer / state，而不是发明过多 hook type。

---

## 1. 当前已覆盖能力

### 1.1 研究设计先于写作

当前系统已有：

- `paper_story_state`
- `review_pressure_packet`
- `write_package`
- `writing_contract`
- `writing_session`

这些已经能防止 writer 在没有 claim / evidence / story spine 的情况下直接写稿。

已落点：

- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/materializers.ts`
- `tools/research-writing/hook-policies.ts`

### 1.2 单一故事线

当前系统已有：

- `STORY_SPINE.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`
- `CONTRIBUTION_TO_STORY_BRIDGE.md`
- `FIGURE_ANCHOR_PLAN.md`
- `paper-plan-thesis-audit`
- `main-tex-consistency-audit`

它已经能检查论文是否围绕同一个主张推进。

### 1.3 Claim / Evidence 覆盖

当前系统已有：

- `CLAIM_EVIDENCE_MATRIX.md`
- `TRACK_VERDICTS.md`
- `UNSUPPORTED_CLAIMS.md`
- `graph_guided_writing`
- `citation_integrity`
- `write_package`

它已经能阻止 unsupported headline claims 和证据不足的写作推进。

### 1.4 图表数量与基本对齐

当前系统已有：

- `FIGURE_REGISTRY.json`
- `TABLE_REGISTRY.json`
- `FIGURE_TABLE_ALIGNMENT.md`
- `figure-table-alignment-audit`
- `final-figure-table-budget-audit`

当前硬门：

- `write` handoff 前至少 1 张 framework / pipeline / method 图。
- `write` handoff 前至少 2 张 experiment / result 表。
- `submit` 前至少 5 张图、4 张表。

### 1.5 Survey 专属覆盖

当前系统已有：

- `SURVEY_COMPARATIVE_ANALYSIS.md`
- `SURVEY_SECTION_BRIEFS.md`
- `SURVEY_SELF_REVIEW.md`
- `SOURCE_TO_CLAIM_INDEX.json`
- survey section hooks

覆盖：

- taxonomy
- evidence synthesis
- benchmark landscape
- open problems
- conclusion boundary

---

## 2. 核心缺口

### 2.1 缺口 A：没有 “pre-draft workbench”

教程最短可执行版要求：

1. 写一句话主张。
2. 列 3 条最强证据。
3. 画出 4 到 6 张关键图。
4. 为每张图写一句结论。
5. 用图序反推 Results 顺序。
6. 写 5 句摘要。
7. 写 5 段引言。
8. 最后再扩写 Methods、Related Work、Discussion。

当前系统只有分散的：

- `PAPER_PLAN.md`
- `FIGURE_ANCHOR_PLAN.md`
- `STORY_SPINE.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`

缺少统一的：

- 一句话主张
- 三条最强证据
- 图表 storyboard
- Results question order
- abstract skeleton
- intro skeleton

### 2.2 缺口 B：标题没有独立 gate

教程要求标题：

- 不空泛
- 不堆术语
- 暗示核心变量 / 机制 / 贡献对象
- 避免 “A Study of / Towards / Approach to”

当前没有：

- `TITLE_CANDIDATES.md`
- `title-contribution-fit-audit`
- `title-low-friction-audit`

### 2.3 缺口 C：摘要没有 5 句骨架合同

教程要求摘要包含：

1. 背景 / 问题
2. 当前缺口
3. 方法或核心发现
4. 关键结果
5. 更广泛意义

当前 `abstract-claim-audit` 主要检查 claim/evidence，不检查五句结构。

### 2.4 缺口 D：引言没有 5 段式结构合同

教程要求引言回答：

1. 为什么问题值得关心
2. 当前最好工作缺什么
3. 缺口为什么不能直接补
4. 本文做了什么
5. 为什么可信
6. 贡献是什么
7. 全文结构如何服务问题

当前 `introduction-gap-story-audit` 有 story gate，但缺少明确 5 段式引言 schema。

### 2.5 缺口 E：Results 没有 “审稿问题顺序” 合同

教程要求先列审稿人最可能问的 5 类问题：

1. 方法真的有效吗？
2. 为什么有效？
3. 和最强基线相比如何？
4. 在哪些条件下会失效？
5. 代价、鲁棒性、泛化性、可扩展性如何？

然后再为每个问题设计实验和图表。

当前系统有 benchmark / statistics / ablation / mechanism / reproducibility gates，但缺少：

- `RESULTS_QUESTION_ORDER.md`
- `EXPERIMENT_EVIDENCE_SEQUENCE.json`
- `results-question-order-audit`

### 2.6 缺口 F：Methods / Approach 的 trade-off 检查不足

教程要求 Methods 讲清三层：

1. 高层直觉
2. 机制细节
3. 实现细节

并要求关键设计点和实验一一对应。

当前没有强 hook 检查：

- method intuition
- module responsibility
- design trade-off
- method claim -> experiment validation mapping

### 2.7 缺口 G：Related Work 公平定位不够硬

教程要求 Related Work：

- 按问题 / 方法族分组
- 公平引用最强 baseline
- 不把不同任务 / 假设的工作硬比
- 明确自己的差异和边界

当前有 `related-work-positioning-audit`，但缺少 deterministic supporting artifacts：

- strongest-baseline list
- related-work taxonomy
- unfair comparison detector
- prior-work omission risk

### 2.8 缺口 H：语言低摩擦没有指标

教程要求：

- 每段一个核心点
- 主题句清晰
- 术语稳定
- 避免长句和翻译腔
- 2 分钟复述测试

当前没有：

- `LANGUAGE_FRICTION_REPORT.json`
- `TERMINOLOGY_LEDGER.md`
- `paragraph-topic-sentence-audit`
- `two-minute-memory-test`

### 2.9 缺口 I：venue-specific 投稿包不够细

教程区分顶刊 / 顶会：

顶会：

- 页数紧
- 匿名化
- 主文自包含
- appendix 不能承载关键论证

顶刊：

- broad significance
- editor screen
- data / code / ethics / reporting
- cover letter / presubmission

当前系统有 `venue_routing` 和 top-tier evidence，但还没有 venue-specific submission pack：

- `VENUE_SUBMISSION_PROFILE.json`
- `MAIN_TEXT_COMPLETENESS_CHECK.md`
- `ANONYMIZATION_AUDIT.md`
- `REPORTING_SUMMARY_CHECKLIST.md`
- `COVER_LETTER_DRAFT.md`

### 2.10 缺口 J：多作者协作合同不完整

教程要求：

- 一作 / 通讯作者 / section owner 明确
- 共享 outline
- 图表先统一审
- 统一术语 / notation
- 所有作者围绕同一主张修稿

当前有 owner / role / task graph / handoff，但缺少：

- `AUTHOR_ROLE_MATRIX.json`
- `SECTION_OWNER_MAP.json`
- `TERMINOLOGY_LEDGER.md`
- `NOTATION_LEDGER.md`
- `FIGURE_FIRST_REVIEW_BOARD.md`

### 2.11 缺口 K：rebuttal change tracking 不够硬

教程要求 rebuttal：

- point-by-point
- 明确改了什么
- 明确改在哪
- 不情绪化
- 不只写 “已修改”

当前已有 rebuttal materializer，但缺少：

- `REVIEW_COMMENT_TRACKER.json`
- `REBUTTAL_CHANGE_MAP.md`
- `MANUSCRIPT_DIFF_SUMMARY.md`
- reviewer comment -> manuscript patch 的可追踪关系

### 2.12 缺口 L：“值得被记住”没有 final gate

教程最后要求论文留下稳定记忆点：

- 新问题定义
- 新机制
- 新实证发现
- 新理论视角
- 可复用系统 / 资源

当前没有：

- `MEMORABILITY_STATEMENT.md`
- `one-sentence-memory-test`
- `non-collaborator-2min-audit`

### 2.13 缺口 M：多个有效创新点容易堆砌，缺少统一故事线整合与补充搜索闭环

当前系统已经能证明多个 innovation point 分别有效，但还不一定能证明它们共同构成一个统一贡献。典型失败形态是：

```text
Innovation A 有效
Innovation B 有效
Innovation C 有效
```

但顶会 / 顶刊论文更需要：

```text
一个中心问题 P
一个统一机制 M
A / B / C 分别解决 M 的必要子矛盾
三者组合后形成不可拆的主贡献
```

因此需要新增 `innovation_synthesis` 能力，判断多个有效创新点之间到底是：

- `causal_chain`
- `complementary_modules`
- `hierarchical_system`
- `problem_decomposition`
- `mechanism_stack`
- `evidence_triangle`

同时必须允许一个重要分支：如果当前 graph / literature / evidence 素材不足以把这些点整合成统一故事线，workflow 不应该强行让 Writer 编造叙事，也不应该永久 block。它应该生成一个 bounded supplemental search request，在 draft 后优化阶段补素材后再整合。

这条设计参考 `Idea-Catalyst Framework`：

- 将目标领域研究问题拆成问题集合 Q。
- 将领域特定问题抽象为领域无关问题 qᵢ'。
- 优先探索未解决或部分解决的问题 `Q_open` / `Q_partial`。
- 用领域无关表述做跨领域检索。
- 从外部源领域提取有文献支撑的概念洞察。
- 将目标领域挑战、源领域洞察和文献链接整合为 idea fragments。
- 用成对比较评估整合深度、创新回报、新颖性与可行性。

进一步约束 story-gap search 的源领域选择策略：

- 使用 Semantic Scholar 支持的粗粒度领域集合作为上层候选空间：
  - `Computer Science`
  - `Medicine`
  - `Chemistry`
  - `Biology`
  - `Materials Science`
  - `Physics`
  - `Geology`
  - `Psychology`
  - `Art`
  - `History`
  - `Geography`
  - `Sociology`
  - `Business`
  - `Political Science`
  - `Economics`
  - `Philosophy`
  - `Mathematics`
  - `Engineering`
  - `Environmental Science`
  - `Agricultural and Food Sciences`
  - `Education`
  - `Law`
  - `Linguistics`
- 默认优先级：
  - `Psychology`
  - `Biology`
  - 然后再考虑 `Sociology`、`Linguistics`、`Physics`、`Engineering`、`Mathematics`
- 但系统不能写死只搜这几个领域，而应：
  1. 先从 domain-agnostic question 推导候选领域。
  2. 排除与目标领域过近的相邻领域。
  3. 对每个候选源领域先做 bounded validation search。
  4. 每个候选域先检索约 `20` 篇论文。
  5. 如果该候选域检索结果中 `>50%` 与当前 gap 不相关，则剪枝。
  6. 只有通过 validation 的源领域才能进入正式 requisition。

关键实现原则：

- `Psychology` 与 `Biology` 是默认优先搜索域，但不是固定答案。
- 候选域必须由 `domain-agnostic question` 驱动，而不是直接用“热门跨学科方向”硬套。
- 对于 AI / CS 论文，系统必须特别避免把过近邻域当成“跨学科整合”，例如：
  - `NLP -> ML`
  - `CV -> ML`
  - `RL -> general AI methods`
- 这种情况可以作为 related / adjacent 支持，但不能算作 story-gap search 的核心源域。
- `literature_discovery` 本身仍属于科研路径前期的主调研环节；这里的 `story-gap search` 不取代它，只用于 draft 完成后、为整合故事线补充缺失桥接证据。

这意味着系统需要区分：

1. 三个有效点只是写作组织没整合好。
2. 三个有效点本身缺少共同机制，需要回到 analysis 重组。
3. graph / literature 素材不足，需要额外搜索。

---

## 3. 目标架构

新增一条写作控制链：

```text
paper_workbench
  -> figure_table_storyboard
  -> results_question_order
  -> title_abstract_intro_skeleton
  -> section drafting
  -> innovation_synthesis
  -> story_gap_search_requisition (only when synthesis evidence is thin)
  -> semantic hooks
  -> language friction audit
  -> venue submission pack
  -> rebuttal/change tracker
  -> memorability gate
```

原则：

1. materializer 负责生成 durable artifacts。
2. deterministic gate 负责数量、存在性、schema、状态。
3. file_audit hook 负责 reviewer 语义判断。
4. 不新增平行 reviewer loop。
5. 优先复用现有 hook points：
   - `artifact_materialized`
   - `before_task_complete`
   - `before_stage_handoff`
   - `before_handoff_activation`
   - `before_prepare_handoff`
   - `before_handoff_delivery`
6. `innovation_synthesis` 是 draft-post-optimization 能力，不作为 Writer 进入 write 阶段的全局前置条件。
7. 如果 graph / literature 素材不足以支持统一故事线，workflow 必须生成 bounded search requisition，而不是让 Writer 编造整合叙事。
8. 额外搜索应复用 Idea-Catalyst 的“领域无关抽象 -> 外部源领域探索 -> idea fragment 整合 -> 成对排序”原则。
9. story-gap search 必须在候选源领域层面做 relevance validation，避免把无关领域大面积引入 graph。
10. 在真相源问题上不追求强硬的全局单源模型：
   - `main.tex` / section drafts / `paper_story_state` 是当前写作现实。
   - `paper_workbench` / `results_storyline` / `innovation_synthesis_state` / `memorability_check` 是可再生的优化派生物。
   - 如果这些派生物与正文轻微漂移，系统应优先重生成或提示修订，而不是立即硬 block。

---

## 4. 新增状态合同

### 4.1 `paper_workbench`

Manifest 字段：

```json
{
  "paper_workbench": {
    "status": "missing|draft|ready|needs_revision",
    "one_sentence_claim": null,
    "core_problem": null,
    "contribution_delta": null,
    "strongest_evidence": [],
    "figure_storyboard_path": "academic_writer/PAPER_WORKBENCH.md",
    "results_question_order_path": "academic_writer/RESULTS_QUESTION_ORDER.md",
    "abstract_skeleton_path": "academic_writer/ABSTRACT_SKELETON.md",
    "intro_skeleton_path": "academic_writer/INTRO_5_PARAGRAPH_PLAN.md",
    "last_updated_at": null
  }
}
```

生成文件：

- `academic_writer/PAPER_WORKBENCH.md`
- `academic_writer/FIGURE_TABLE_STORYBOARD.md`
- `academic_writer/RESULTS_QUESTION_ORDER.md`
- `academic_writer/ABSTRACT_SKELETON.md`
- `academic_writer/INTRO_5_PARAGRAPH_PLAN.md`

### 4.2 `title_package`

```json
{
  "title_package": {
    "status": "missing|draft|ready|needs_revision",
    "selected_title": null,
    "candidate_titles_path": "academic_writer/TITLE_CANDIDATES.md",
    "title_claim_alignment_status": "missing|aligned|weak|fail",
    "last_updated_at": null
  }
}
```

### 4.3 `results_storyline`

```json
{
  "results_storyline": {
    "status": "missing|draft|ready|needs_revision",
    "question_order": [],
    "evidence_modules": [],
    "figure_table_order": [],
    "results_question_order_path": "academic_writer/RESULTS_QUESTION_ORDER.md",
    "experiment_evidence_sequence_path": "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json",
    "last_updated_at": null
  }
}
```

### 4.4 `language_friction`

```json
{
  "language_friction": {
    "status": "missing|draft|pass|needs_revision",
    "report_path": "reviewer/LANGUAGE_FRICTION_REPORT.json",
    "terminology_ledger_path": "academic_writer/TERMINOLOGY_LEDGER.md",
    "long_sentence_count": 0,
    "term_drift_count": 0,
    "paragraph_issue_count": 0,
    "last_updated_at": null
  }
}
```

### 4.5 `venue_submission_profile`

```json
{
  "venue_submission_profile": {
    "status": "missing|draft|ready|needs_revision",
    "venue_name": null,
    "venue_type": "conference|journal|unknown",
    "anonymous_required": false,
    "page_limit": null,
    "main_text_self_contained_required": true,
    "code_data_reporting_required": false,
    "cover_letter_required": false,
    "profile_path": "academic_writer/VENUE_SUBMISSION_PROFILE.json",
    "checklist_path": "reviewer/VENUE_SUBMISSION_CHECKLIST.md",
    "last_updated_at": null
  }
}
```

### 4.6 `collaboration_contract`

```json
{
  "collaboration_contract": {
    "status": "missing|draft|ready",
    "author_role_matrix_path": "orchestrator/AUTHOR_ROLE_MATRIX.json",
    "section_owner_map_path": "academic_writer/SECTION_OWNER_MAP.json",
    "terminology_ledger_path": "academic_writer/TERMINOLOGY_LEDGER.md",
    "notation_ledger_path": "academic_writer/NOTATION_LEDGER.md",
    "last_updated_at": null
  }
}
```

### 4.7 `rebuttal_change_tracker`

```json
{
  "rebuttal_change_tracker": {
    "status": "missing|draft|ready|needs_revision",
    "comment_tracker_path": "reviewer/REVIEW_COMMENT_TRACKER.json",
    "change_map_path": "reviewer/REBUTTAL_CHANGE_MAP.md",
    "manuscript_diff_summary_path": "reviewer/MANUSCRIPT_DIFF_SUMMARY.md",
    "unmapped_comment_count": 0,
    "last_updated_at": null
  }
}
```

### 4.8 `memorability_check`

```json
{
  "memorability_check": {
    "status": "missing|draft|pass|needs_revision",
    "memory_statement_path": "academic_writer/MEMORABILITY_STATEMENT.md",
    "one_sentence_memory": null,
    "stable_memory_type": "problem_definition|mechanism|finding|theory|system|resource|unknown",
    "last_updated_at": null
  }
}
```

### 4.9 `innovation_synthesis_state`

用于把多个有效 innovation point 整合成一个统一贡献，而不是 contribution bullet 堆砌。

```json
{
  "innovation_synthesis_state": {
    "status": "missing|draft|ready|needs_revision|needs_search",
    "central_thesis": null,
    "integration_pattern": "causal_chain|complementary_modules|hierarchical_system|problem_decomposition|mechanism_stack|evidence_triangle|unknown",
    "innovation_points": [
      {
        "id": "innovation_a",
        "claim": null,
        "role_in_story": null,
        "evidence_ids": [],
        "required_for_thesis": true,
        "failure_if_removed": null,
        "support_status": "missing|partial|supported|contradicted"
      }
    ],
    "unified_mechanism": null,
    "story_dependency_graph_path": "academic_writer/INNOVATION_SYNTHESIS_GRAPH.json",
    "synthesis_memo_path": "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
    "integrated_contribution_statement_path": "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
    "figure_1_story_role": null,
    "results_order_rationale": null,
    "search_gap_count": 0,
    "search_requisition_path": null,
    "last_updated_at": null
  }
}
```

核心字段：

- `central_thesis`：整篇论文唯一主贡献轴。
- `integration_pattern`：多个 innovation point 之间的关系类型。
- `role_in_story`：每个创新点在中心故事里的必要作用。
- `failure_if_removed`：去掉该点后主机制断在哪里。
- `search_gap_count`：当前素材不足以整合故事线的缺口数量。

### 4.10 `story_gap_search_requisition`

当 `innovation_synthesis_state.status = needs_search` 时生成。它不是普通 graph refresh，而是“为了整合故事线”触发的 bounded search。

重要约束：

- 它不是第二套独立搜索控制面。
- 它必须映射到现有 `literature_discovery` / `paper_ingestion.queued_requests` / `graph_build` 路径，或者作为不进 graph 的轻量补证据 sidecar。
- 也就是说，`story_gap_search_requisition` 是一个 specialization / overlay，不是平行 runtime。

```json
{
  "story_gap_search_requisition": {
    "status": "missing|queued|running|completed|saturated|failed",
    "origin_stage": "analyze|write|review",
    "trigger_reason": "innovation_synthesis_gap|weak_integration|missing_bridge_evidence|contradictory_points",
    "execution_mode": "reuse_literature_discovery|search_only_without_graph_import",
    "maps_to_literature_discovery_request_id": null,
    "requisition_fingerprint": null,
    "linked_synthesis_fingerprint": null,
    "same_gap_cycle_budget": 2,
    "same_gap_cycles_used": 0,
    "target_questions": [
      {
        "question_id": "q1",
        "domain_specific_question": null,
        "domain_agnostic_question": null,
        "coverage_status": "unexplored|partial|resolved",
        "preferred_source_domains": ["Psychology", "Biology"],
        "candidate_source_domains": [],
        "excluded_adjacent_domains": [],
        "validation_sample_size_default": 20,
        "prune_if_irrelevant_ratio_exceeds_default": 0.5,
        "minimum_relevant_hits": 5,
        "niche_topic_override_allowed": true,
        "minimum_sources": 2
      }
    ],
    "required_stage_reentry": ["graph_build", "analyze", "write"],
    "packet_path": "researcher/story-gap-search/STORY_GAP_SEARCH_REQUISITION.json",
    "batch_manifest_path": "researcher/story-gap-search/batch-import.json",
    "last_updated_at": null
  }
}
```

该状态沿用 Idea-Catalyst 策略：

- 先做 domain-specific -> domain-agnostic abstraction。
- 优先搜索 unresolved / partial 的概念缺口。
- 支持跨领域源域探索。
- 搜索结果进入 graph / literature 后，再回到 analysis 或 writing workbench 重新整合。
- 但必须增加 candidate-domain validation：
  - 先生成候选域。
  - 优先从 `Psychology` / `Biology` 开始尝试。
  - 如果这些默认高优先级域与 gap 不匹配，可降级到其他粗粒度领域。
  - 每个候选域默认先做 20 篇级别的快速验证。
  - 默认若不相关比例超过 50%，立即剪枝。
  - 但这些值是 policy default，不是固定常数：
    - 窄主题
    - 新兴方向
    - 低文献量领域
    - 多语言语料
    可以 override。

---

## 5. 新增 materializers

### 5.1 `tools/research-writing/paper-workbench.ts`

职责：

- 从 `paper_story_state`、`write_package`、`experiment_search`、`survey_review` 读取输入。
- 生成：
  - one-sentence claim
  - three strongest evidence bullets
  - figure/table storyboard
  - results question order
  - abstract skeleton
  - intro skeleton

输出：

- `academic_writer/PAPER_WORKBENCH.md`
- `academic_writer/FIGURE_TABLE_STORYBOARD.md`
- `academic_writer/RESULTS_QUESTION_ORDER.md`
- `academic_writer/ABSTRACT_SKELETON.md`
- `academic_writer/INTRO_5_PARAGRAPH_PLAN.md`

### 5.2 `tools/research-writing/title-package.ts`

职责：

- 生成 5-10 个 candidate titles。
- 标注每个 title 的对象、机制、结果、贡献变量。
- 选择一个 preferred title。
- 标记 weak title pattern，例如：
  - `A Study of`
  - `Towards`
  - `An Approach to`
  - `Some Notes on`

### 5.3 `tools/research-writing/results-storyline.ts`

职责：

- 从 `experiment_search`、`EXPERIMENT_LEDGER.json`、`CLAIM_EVIDENCE_MATRIX.md` 反推 Results 论证顺序。
- 生成 5 类 reviewer question：
  1. effectiveness
  2. mechanism
  3. strongest baseline
  4. failure / boundary
  5. cost / robustness / scalability
- 将每个 question 绑定到 figure/table/evidence artifact。

### 5.4 `tools/research-writing/language-friction.ts`

职责：

- 扫描 main.tex / sections。
- 检查：
  - 长句
  - 术语漂移
  - 段落主题句缺失
  - caption 是否独立可读
  - abstract / intro / contribution / Figure 1 caption 是否一致

输出：

- `reviewer/LANGUAGE_FRICTION_REPORT.json`
- `academic_writer/TERMINOLOGY_LEDGER.md`

### 5.5 `tools/research-submit/venue-submission-profile.ts`

职责：

- 基于 `venue_routing` / `opportunity_scorecard` / 用户配置生成 venue-specific checklist。
- 输出：
  - `academic_writer/VENUE_SUBMISSION_PROFILE.json`
  - `reviewer/VENUE_SUBMISSION_CHECKLIST.md`
  - `reviewer/ANONYMIZATION_AUDIT.md`
  - `reviewer/MAIN_TEXT_COMPLETENESS_CHECK.md`
  - `academic_writer/COVER_LETTER_DRAFT.md`（journal only）

### 5.6 `tools/research-writing/collaboration-contract.ts`

职责：

- 生成 section owner map。
- 生成 author role matrix。
- 生成 terminology / notation ledger。
- 在多人/多 agent 写作时保证术语和主张统一。

### 5.7 `tools/research-submit/rebuttal-change-tracker.ts`

职责：

- 解析 reviewer comments。
- 生成 point-by-point tracker。
- 要求每条 reviewer comment 映射到：
  - response text
  - manuscript edit location
  - figure/table update
  - evidence artifact

### 5.8 `tools/research-writing/memorability-check.ts`

职责：

- 生成 one-sentence memory statement。
- 标记论文希望被记住的类型：
  - problem definition
  - mechanism
  - finding
  - theory
  - system
  - resource
- 提供 final audit 输入。

### 5.9 `tools/research-writing/innovation-synthesis.ts`

职责：

- 读取多个已验证 innovation point。
- 从 `experiment_search`、`EXPERIMENT_LEDGER.json`、`CLAIM_EVIDENCE_MATRIX.md`、`CLAIM_TO_EXPERIMENT_MAP.md`、`FIGURE_TABLE_ALIGNMENT.md`、`write_package`、`paper_story_state` 中提取证据。
- 生成：
  - `academic_writer/INNOVATION_SYNTHESIS_MEMO.md`
  - `academic_writer/INNOVATION_SYNTHESIS_GRAPH.json`
  - `academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md`
- 判断 innovation point 之间的整合模式。
- 判断是否素材不足。

`INNOVATION_SYNTHESIS_MEMO.md` 建议结构：

```markdown
# Innovation Synthesis Memo

## One Central Thesis
...

## Why The Innovation Points Are Not Independent
...

## Integration Pattern
causal_chain / complementary_modules / mechanism_stack / ...

## Innovation Roles
| Innovation | Story role | Evidence | What breaks without it |
| --- | --- | --- | --- |

## Unified Mechanism
...

## Figure 1 Story
...

## Results Order Rationale
...

## Search Gaps
...
```

如果无法形成统一机制，该 materializer 不应强行输出 `ready`，而应：

- `status = needs_search`
- 生成 search gaps
- 生成 `story_gap_search_requisition`

并且要使用轻量真相源策略：

- `innovation_synthesis_state` 不是总真相源。
- 它是对当前 manuscript / story state 的整合性解释层。
- 当它与 `main.tex` / section drafts / `paper_story_state` 漂移时：
  - 优先重生成
  - 或要求 reviewer 标记 `needs_revision`
  - 不要求所有派生物绝对同步才允许写作

### 5.10 `tools/research-writing/story-gap-search.ts`

职责：

- 将 synthesis gaps 转换成 Idea-Catalyst 风格 search requisition。
- 对每个 gap 生成：
  - domain-specific question
  - domain-agnostic question
  - preferred source domains
  - candidate source domains
  - excluded adjacent domains
  - validation sample size
  - prune threshold
  - minimum source requirements
- 复用 literature discovery / PaperNexus ingestion path。
- 支持 reentry：
  - `graph_build`
  - `analyze`
  - `write`

输出：

- `researcher/story-gap-search/STORY_GAP_SEARCH_REQUISITION.json`
- `researcher/story-gap-search/STORY_GAP_SEARCH_PACKET.md`
- `researcher/story-gap-search/batch-import.json`

该 materializer 应复用或扩展现有：

- `tools/literature-discovery/materializer.ts`
- `tools/literature-discovery/workflow-bridge.ts`
- `tools/idea-catalyst/workflow-bridge.ts`

它应明确采用一对一映射：

- 如果需要 graph import：
  - 生成 `story_gap_search_requisition`
  - 再映射到现有 `literature_discovery` request / `paper_ingestion.queued_requests`
- 如果只需要补若干对齐性 source：
  - 使用 `search_only_without_graph_import`
  - 不创建第二套 queue / retry / reentry runtime

并新增 source-domain selection policy：

1. 将 `domain_agnostic_question` 映射到粗粒度领域候选集。
2. 默认优先 `Psychology`、`Biology`。
3. 第二优先层：
   - `Sociology`
   - `Linguistics`
   - `Physics`
   - `Engineering`
   - `Mathematics`
4. 排除目标领域邻近域。
5. 对每个候选域先执行 `20` 篇验证检索。
6. 如果相关性低于 50%，则剪枝。
7. 最终 requisition 只保留通过验证的 source domains。

同时要求：

- `requisition_fingerprint` 由：
  - `central_thesis`
  - unresolved integration edges
  - domain-agnostic questions
  - validated source domains
  共同组成
- 如果新请求 fingerprint 与最近一次相同，且 cycles 已用尽，则直接进入 `saturated`

---

## 6. 新增 hooks

### 6.1 `paper-workbench-readiness-audit`

Hook point:

- `artifact_materialized`
- `before_stage_handoff`

Target:

- `academic_writer/PAPER_WORKBENCH.md`

要求：

- 一句话主张存在且聚焦。
- 三条 strongest evidence 都可回指 durable evidence。
- figure/table storyboard 覆盖 4-8 个关键视觉证据。
- Results question order 能反推出实验顺序。

### 6.2 `title-contribution-fit-audit`

Hook point:

- `before_task_complete`
- `before_handoff_activation`

Target:

- `academic_writer/TITLE_CANDIDATES.md`

要求：

- 标题不空泛。
- 标题能透露对象 / 机制 / 贡献变量。
- 不使用弱标题模板。
- title 与 abstract / contribution list / Figure 1 caption 一致。

### 6.3 `abstract-five-sentence-audit`

Hook point:

- `before_task_complete`

Target:

- `academic_writer/paper/sections/abstract.tex`

要求：

- problem
- gap
- method / finding
- key result
- implication

且每个强 claim 可回指 evidence。

### 6.4 `intro-five-paragraph-audit`

Hook point:

- `before_task_complete`

Target:

- `academic_writer/paper/sections/introduction.tex`

要求：

1. 大问题与重要性
2. 当前局限
3. 本文思路与直觉
4. 关键证据摘要
5. 贡献列表

### 6.5 `results-question-order-audit`

Hook point:

- `before_task_complete`
- `before_handoff_activation`

Target:

- `academic_writer/RESULTS_QUESTION_ORDER.md`

要求：

- Results 顺序必须回答 reviewer question。
- 每个 question 必须绑定 evidence artifact 和 figure/table。
- 不能按实验流水账排列。

### 6.6 `method-tradeoff-audit`

Hook point:

- `before_task_complete`

Target:

- `academic_writer/paper/sections/method.tex`

要求：

- 先讲高层直觉，再讲机制，再讲实现。
- 每个关键模块只承担一个职责。
- 关键设计点和 experiment validation 一一对应。
- trade-off 显式说明。

### 6.7 `related-work-fairness-audit`

Hook point:

- `before_task_complete`

Target:

- `academic_writer/paper/sections/related_work.tex`

要求：

- 按方法族 / 问题族组织。
- 引用 strongest baselines。
- 不错误贬低 prior work。
- 不把不同任务/设定硬比。
- 清楚说明本文差异和边界。

### 6.8 `language-friction-audit`

Hook point:

- `before_stage_handoff`
- `before_handoff_activation`

Target:

- `reviewer/LANGUAGE_FRICTION_REPORT.json`

要求：

- 长句数量低于阈值。
- 术语漂移为 0 或有 waiver。
- 每段单点推进。
- 图 1 caption / abstract / contribution list 一致。
- 非直接合作者 2 分钟复述测试可通过。

### 6.9 `venue-submission-checklist-audit`

Hook point:

- `before_stage_handoff`
- `before_handoff_activation`

Target:

- `reviewer/VENUE_SUBMISSION_CHECKLIST.md`

要求：

- conference:
  - page limit
  - anonymization
  - main-text self-contained
  - appendix 不承载关键论证
- journal:
  - broad significance
  - reporting summary
  - code/data availability
  - ethics / disclosure
  - cover letter

### 6.10 `rebuttal-change-map-audit`

Hook point:

- `before_stage_handoff`
- `before_handoff_activation`

Target:

- `reviewer/REBUTTAL_CHANGE_MAP.md`

要求：

- 每条 reviewer comment 有编号。
- 每条 comment 有 response。
- 每条 response 说明改了什么、改在哪。
- 不允许只写 “done / fixed”。

### 6.11 `memorability-audit`

Hook point:

- `before_stage_handoff`
- `before_handoff_activation`

Target:

- `academic_writer/MEMORABILITY_STATEMENT.md`

要求：

- 读者能记住一个稳定贡献。
- memory type 清晰。
- 与 title / abstract / intro / conclusion 一致。

### 6.12 `innovation-synthesis-audit`

Hook point:

- `artifact_materialized`
- `before_stage_handoff`
- `before_task_complete`
- `before_handoff_activation`

Target:

- `academic_writer/INNOVATION_SYNTHESIS_MEMO.md`
- `academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md`

要求：

- 不能只是列出 3 个 contribution bullets。
- 必须有一个 `central_thesis`。
- 每个 innovation point 必须有 `role_in_story`。
- 每个 innovation point 必须说明 `failure_if_removed`。
- 三个点之间必须有明确关系词，例如 enables / isolates / stabilizes / generalizes / composes / decomposes。
- Figure 1 必须表达整合机制，而不是展示三个孤立模块。
- Results 顺序必须证明整合关系。
- Abstract / Introduction / Conclusion 必须使用同一套 integrated contribution wording。

特殊分支：

- 如果 hook 判断“不是写作组织问题，而是 graph / literature 素材不足”，不能只返回普通 `revise`。
- 应返回 `revise`，并要求 materializer 将 `innovation_synthesis_state.status` 标为 `needs_search`。
- 后续由 deterministic gate 阻止写作推进，并触发 `story_gap_search_requisition`。

推荐 hook 时机：

- 不把它作为 Writer 进入 `write` 的全局前置门。
- 主要用于：
  - `before_stage_handoff`：`write -> review`
  - `before_stage_handoff`：`review -> submit`
  - `before_handoff_activation`
  - `before_task_complete`：仅在 intro/results/conclusion 的后期 closeout 时使用

### 6.13 `story-gap-search-readiness-audit`

Hook point:

- `artifact_materialized`
- `before_stage_handoff`

Target:

- `researcher/story-gap-search/STORY_GAP_SEARCH_REQUISITION.json`

要求：

- 每个 search gap 必须有 domain-specific 和 domain-agnostic 表述。
- search target 必须优先覆盖 unresolved / partial 的概念缺口。
- source domains 不能只是目标领域相邻子领域；应允许跨领域探索。
- `Psychology` / `Biology` 应作为默认优先候选域，但只有通过 relevance validation 才能进入正式 requisition。
- 每个候选域默认先执行 `20` 篇论文级别的 validation 检索。
- 如果某候选域默认不相关比例 `>50%`，必须剪枝，不允许继续进入 graph import。
- 这些只是 policy default，必须允许按 topic override。
- 每个 search request 必须说明它要支持哪个 innovation integration edge。
- 如果已经达到 saturation，应停止搜索并要求重写 synthesis，而不是无限循环。

---

## 7. Deterministic gates

### 7.1 Write stage 新增 blockers

在 `collectWriteStageMissingSignals(...)` 增加：

- `paper_workbench.status = ready`
- `title_package.status = ready`
- `results_storyline.status = ready`
- `figure_table_storyboard_path` 存在
- `abstract_skeleton_path` 存在
- `intro_skeleton_path` 存在
- write-level visual budget：
  - framework figure >= 1
  - experiment/result table >= 2
- `innovation_synthesis_state` 在 write 内默认允许 `draft|needs_revision`，不作为进入 write 的全局 blocker
- 但如果 `innovation_synthesis_state.status = needs_search`：
  - 不阻止 Writer 继续修稿
  - 阻止 `write -> review` handoff
  - 并要求生成 `story_gap_search_requisition`

### 7.2 Submit stage 新增 blockers

在 `collectSubmitStageMissingSignals(...)` 增加：

- `language_friction.status = pass`
- `innovation_synthesis_state.status = ready`
- `venue_submission_profile.status = ready`
- `memorability_check.status = pass`
- final visual budget：
  - figures >= 5
  - tables >= 4
- if revision mode:
  - `rebuttal_change_tracker.status = ready`

### 7.3 Review stage 新增 blockers

在 review closeout 前增加：

- `review_pressure_packet` 已覆盖：
  - unsupported claim audit
  - reverse outline
  - figure/table qc
  - limitation audit
- `related_work_fairness_audit` 已 pass 或有 waiver
- `innovation_synthesis_state.status != missing`
- 如果 reviewer 判断贡献点堆砌，则回到 `write.workbench` / `analyze`，而不是允许直接 polish。
- 对 `innovation_synthesis_state` 的真正硬门放在：
  - `write -> review`
  - `review -> submit`
  - final handoff activation

### 7.4 Graph / literature 素材不足时的 reentry gate

新增 workflow-owned reentry 规则：

```text
innovation_synthesis_state.status = needs_search
  -> materialize story_gap_search_requisition
  -> if execution_mode = reuse_literature_discovery, map to existing literature_discovery / paper_ingestion queue
  -> if graph import is needed, route graph_build
  -> if only source supplementation is needed, stay in analyze / draft optimization lane
  -> rerun analyze if claim/evidence matrix needs update
  -> rerun write.workbench / innovation_synthesis
```

要求：

- 该路径应复用现有 graph_build 和 literature discovery reentry，不新增平行 ingestion 系统。
- 搜索必须 bounded，有 retry budget 和 saturation signal。
- 如果搜索 saturated 仍无法整合故事线，应返回 `needs_revision`，要求缩小 central thesis 或降级 contribution。

---

## 8. Task surface 改造

当前已有 section-level task surface。需要新增/调整：

### 8.1 `write.workbench`

Owner:

- `academic_writer`

产物：

- `PAPER_WORKBENCH.md`
- `FIGURE_TABLE_STORYBOARD.md`
- `RESULTS_QUESTION_ORDER.md`
- `ABSTRACT_SKELETON.md`
- `INTRO_5_PARAGRAPH_PLAN.md`

### 8.2 `write.title_abstract_intro`

Owner:

- `academic_writer`

产物：

- `TITLE_CANDIDATES.md`
- abstract draft
- introduction draft

### 8.3 `write.results_storyline`

Owner:

- `academic_writer`
- support from `coder` / `analyzer`

产物：

- `RESULTS_QUESTION_ORDER.md`
- `EXPERIMENT_EVIDENCE_SEQUENCE.json`

### 8.4 `write.figure_table_alignment`

Owner:

- `academic_writer`
- support from `coder`
- review by `reviewer`

产物：

- `FIGURE_TABLE_ALIGNMENT.md`
- updated `FIGURE_REGISTRY.json`
- updated `TABLE_REGISTRY.json`

### 8.5 `write.innovation_synthesis`

Owner:

- `academic_writer`
- support from `analyzer`
- support from `coder` when experiment/table provenance is needed
- review by `reviewer`

产物：

- `INNOVATION_SYNTHESIS_MEMO.md`
- `INNOVATION_SYNTHESIS_GRAPH.json`
- `INTEGRATED_CONTRIBUTION_STATEMENT.md`

如果素材不足：

- 生成 `STORY_GAP_SEARCH_REQUISITION.json`
- handoff 回 `researcher` / `analyzer`
- route through `graph_build` if new graph/literature ingestion is needed

### 8.6 `review.language_friction`

Owner:

- `reviewer`

产物：

- `LANGUAGE_FRICTION_REPORT.json`
- `TERMINOLOGY_LEDGER.md`

### 8.7 `submit.venue_pack`

Owner:

- `reviewer`
- `academic_writer`

产物：

- `VENUE_SUBMISSION_PROFILE.json`
- `VENUE_SUBMISSION_CHECKLIST.md`
- `ANONYMIZATION_AUDIT.md`
- `MAIN_TEXT_COMPLETENESS_CHECK.md`
- `COVER_LETTER_DRAFT.md` if journal

---

## 9. Implementation phases

### Phase A：Pre-draft workbench

Files:

- `tools/research-writing/paper-workbench.ts`
- `tools/workflow-guard-state/paper-workbench.ts`
- `tools/workflow-guard-setters/writing-state-setters.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`

Tasks:

- Normalize / serialize `paper_workbench`.
- Materialize workbench artifacts.
- Add `paper-workbench-readiness-audit`.
- Add write-stage deterministic blockers.

Tests:

- `tests/paper-workbench-materializer.test.mjs`
- `tests/workflow-writing-workbench-hooks.test.mjs`
- update `tests/auto-iterator.test.mjs`

### Phase B：Title / Abstract / Introduction hardening

Files:

- `tools/research-writing/title-package.ts`
- `tools/research-writing/abstract-intro-skeleton.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Materialize title candidates.
- Materialize 5-sentence abstract skeleton.
- Materialize 5-paragraph intro skeleton.
- Add hooks:
  - `title-contribution-fit-audit`
  - `abstract-five-sentence-audit`
  - `intro-five-paragraph-audit`

Tests:

- `tests/title-abstract-intro-hooks.test.mjs`
- section task closeout tests

### Phase C：Results question order

Files:

- `tools/research-writing/results-storyline.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Generate `RESULTS_QUESTION_ORDER.md`.
- Generate `EXPERIMENT_EVIDENCE_SEQUENCE.json`.
- Bind reviewer questions to figures/tables/evidence artifacts.
- Add `results-question-order-audit`.

Tests:

- `tests/results-question-order.test.mjs`
- `tests/workflow-control-plane-phase-3.test.mjs`

### Phase D：Methods / Related Work hardening

Files:

- `tools/research-writing/method-tradeoff.ts`
- `tools/research-writing/related-work-fairness.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Method trade-off packet.
- Strongest baseline / related work taxonomy.
- Add hooks:
  - `method-tradeoff-audit`
  - `related-work-fairness-audit`

Tests:

- `tests/method-tradeoff-audit.test.mjs`
- `tests/related-work-fairness-audit.test.mjs`

### Phase E：Language friction

Files:

- `tools/research-writing/language-friction.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Generate `LANGUAGE_FRICTION_REPORT.json`.
- Generate `TERMINOLOGY_LEDGER.md`.
- Add deterministic blockers for severe friction.
- Add `language-friction-audit`.

Tests:

- `tests/language-friction.test.mjs`

### Phase F：Venue submission pack

Files:

- `tools/research-submit/venue-submission-profile.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Generate venue profile.
- Generate checklist.
- Add conference/journal-specific gates.
- Add `venue-submission-checklist-audit`.

Tests:

- `tests/venue-submission-profile.test.mjs`
- `tests/submit-venue-gates.test.mjs`

### Phase G：Collaboration contract

Files:

- `tools/research-writing/collaboration-contract.ts`
- `tools/workflow-team/stage-profiles.ts`
- `tools/workflow-team/task-graph.ts`

Tasks:

- Generate author role matrix.
- Generate section owner map.
- Generate terminology / notation ledger.
- Bind section tasks to owners.

Tests:

- `tests/collaboration-contract.test.mjs`
- workflow team runtime tests

### Phase H：Rebuttal / revision change tracking

Files:

- `tools/research-submit/rebuttal-change-tracker.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Parse reviewer comments.
- Create comment tracker.
- Map comments to manuscript changes.
- Add `rebuttal-change-map-audit`.

Tests:

- `tests/rebuttal-change-tracker.test.mjs`

### Phase I：Memorability gate

Files:

- `tools/research-writing/memorability-check.ts`
- `tools/research-writing/hook-policies.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`

Tasks:

- Generate memorability statement.
- Add deterministic status.
- Add `memorability-audit`.

Tests:

- `tests/memorability-gate.test.mjs`

### Phase J：Innovation synthesis 与 story-gap search

Files:

- `tools/research-writing/innovation-synthesis.ts`
- `tools/research-writing/story-gap-search.ts`
- `tools/workflow-guard-state/innovation-synthesis.ts`
- `tools/workflow-guard-state/story-gap-search.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- Normalize / serialize `innovation_synthesis_state`。
- Normalize / serialize `story_gap_search_requisition`。
- Materialize innovation synthesis memo / graph / integrated contribution statement。
- 判断 innovation point 是不是堆砌。
- 当 graph / literature 素材不足时生成 bounded story-gap search requisition。
- 复用 Idea-Catalyst 的：
  - domain-specific question
  - domain-agnostic abstraction
  - Q_open / Q_partial 优先级
  - external source domain exploration
  - idea fragment integration
  - pairwise ranking
- 将 source-domain selection 约束为：
  - 21 个粗粒度领域候选池
  - `Psychology` / `Biology` 默认优先
  - 排除邻近领域
  - `20` 篇验证检索
  - `>50%` 不相关则剪枝
- 将 completed search 重新接回 analyze / writing workbench。
- Add hooks:
  - `innovation-synthesis-audit`
  - `story-gap-search-readiness-audit`

Tests:

- `tests/innovation-synthesis-materializer.test.mjs`
- `tests/innovation-synthesis-hooks.test.mjs`
- `tests/story-gap-search-reentry.test.mjs`
- `tests/auto-iterator.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`

### Phase K：Results storyline 结构化论证层

稳定实现原则：

- 不把 Results 顺序继续留在 prompt 里，也不只靠 reviewer 主观判断。
- 不新增平行搜索系统。
- 不要求 Writer 进入 `write` 前就把 Results 顺序完全固定。
- 采用 `late-write optimization contract`：
  - 进入 `write` 时自动物化
  - 在 `review -> submit` closeout 时变成硬门

Files:

- `tools/research-writing/results-storyline.ts`
- `tools/workflow-guard-state/results-storyline.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- 新增 `results_storyline` durable state。
- 读取：
  - `paper_story_state`
  - `write_package`
  - `CLAIM_EVIDENCE_MATRIX.md`
  - `CLAIM_TO_EXPERIMENT_MAP.md`
  - `FIGURE_TABLE_ALIGNMENT.md`
  - `TRACK_VERDICTS.md`
- experiment line 中生成 reviewer-question 顺序：
  - effectiveness
  - mechanism
  - strongest baseline
  - boundary / failure
  - robustness / cost / scalability
- survey line 中生成 synthesis 顺序：
  - scope / protocol
  - taxonomy
  - evidence synthesis
  - benchmark landscape
  - open problems
- 产出：
  - `academic_writer/RESULTS_QUESTION_ORDER.md`
  - `academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json`
- 在 `write/review/submit` preflight 中自动重物化。
- 添加 `results-storyline-audit`。
- `write` 内只要求 `status != missing`。
- `submit` 前要求 `status = ready`。

Tests:

- `tests/workflow-results-storyline.test.mjs`
- `tests/workflow-writing-hooks-policy.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`

### Phase L：Title / Abstract / Intro workbench

稳定实现原则：

- 这是 post-draft alignment layer，不是抢 Writer 主写权。
- 以当前 manuscript / story state 为现实输入，以 workbench 为可再生优化派生物。
- 不把它做成“固定模板填空器”，而是做成 reviewer / writer 可复用的结构支架。

Files:

- `tools/research-writing/title-abstract-intro-workbench.ts`
- `tools/workflow-guard-state/title-abstract-intro-workbench.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/research-writing/hook-policies.ts`

Tasks:

- 新增 `title_abstract_intro_workbench` durable state。
- 读取：
  - `paper_story_state`
  - `results_storyline`
  - `innovation_synthesis_state`
  - `review_pressure_packet`
  - `writing_contract`
  - `academic_writer/paper/main.tex`
- 产出：
  - `academic_writer/TITLE_CANDIDATES.md`
  - `academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md`
  - `academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md`
- title 生成要求：
  - 给出多个候选标题
  - 标出 preferred title
  - 显式规避弱标题模式：
    - `A Study of`
    - `Towards`
    - `An Approach to`
    - `Some Notes on`
- abstract 生成要求：
  - problem
  - gap
  - method / mechanism
  - key result
  - implication / boundary
- intro 生成要求：
  - why this problem matters
  - why current work is insufficient
  - what unified mechanism / lens this paper contributes
  - what evidence supports it
  - what the reader should expect next
- 在 `write/review/submit` preflight 中自动重物化。
- 添加 `title-abstract-intro-alignment-audit`。
- `write` 内只要求 `status != missing`。
- `submit` 前要求 `status = ready`。

Tests:

- `tests/workflow-title-abstract-intro-workbench.test.mjs`
- `tests/workflow-writing-hooks-policy.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`

### Phase M：Structured gap classifier

稳定实现原则：

- 把 `needs_search` 从单一布尔值升级成结构化缺口分类。
- 只有“真的缺外部桥接素材”时才允许触发搜索。
- 组织不清、顺序不清、标题摘要引言没对齐，不进入外部搜索。

Gap classes:

- `bridge_mechanism_missing`
- `cross_domain_analogy_missing`
- `results_order_unjustified`
- `title_abstract_intro_drift`

Routing:

- `bridge_mechanism_missing`
  - 走 `PaperNexus + literature_discovery + graph_build`
- `cross_domain_analogy_missing`
  - 走 `Idea Catalyst / cross_domain_inspiration`
- `results_order_unjustified`
  - 走 `results_storyline` 重整，不触发搜索
- `title_abstract_intro_drift`
  - 走 `title_abstract_intro_workbench` 重整，不触发搜索

Tasks:

- 在 `innovation_synthesis` materializer 中输出 gap class，而不是只输出 `needs_search`。
- 将 `story_gap_search_requisition.trigger_reason` 细化为结构化类别。
- 对 `results_storyline` / `title_abstract_intro_workbench` 漂移，优先走本地重整。
- 只在 `bridge_mechanism_missing` / `cross_domain_analogy_missing` 时复用现有 `literature_discovery` 或 `Idea Catalyst`。

Tests:

- `tests/workflow-innovation-synthesis.test.mjs`
- `tests/papernexus-packet-integration.test.mjs`
- `tests/workflow-control-plane-phase-3.test.mjs`

---

## 10. Acceptance criteria

完成后，系统应满足：

1. Writer 不能在没有 `paper_workbench.ready` 的情况下进入正式 section drafting。
2. Writer 不能在没有 figure/table storyboard 的情况下进入 Results drafting。
3. Writer 不能在 `innovation_synthesis_state.status != ready` 时进入正式整稿。
4. 如果多个 innovation point 只是并列堆砌，workflow 必须要求回到 writing workbench 或 analysis 重整故事线。
5. 如果 graph / literature 素材不足以整合故事线，workflow 必须生成 bounded story-gap search requisition，而不是强行写作。
6. Abstract 必须符合 5 句骨架。
7. Introduction 必须符合 5 段式结构。
8. Results 必须按 reviewer question order 组织。
9. Methods 必须说明 intuition / mechanism / implementation / trade-off。
10. Related Work 必须公平定位 strongest baselines。
11. `write` handoff 前：
   - framework figure >= 1
   - experiment/result tables >= 2
12. `submit` 前：
   - figures >= 5
   - tables >= 4
   - language friction pass
   - venue checklist ready
   - memorability pass
13. Rebuttal / revision 时，每条 reviewer comment 都有 change map。

---

## 11. Verification plan

每个 phase 至少跑：

- `npm exec tsc -- --noEmit`
- `npm run build`
- targeted new tests
- existing broad workflow suite:

```bash
node --test \
  tests/auto-iterator.test.mjs \
  tests/experiment-auto-review-loop.test.mjs \
  tests/experiment-decision-routing.test.mjs \
  tests/workflow-control-plane-phase-3.test.mjs \
  tests/workflow-survey-route.test.mjs \
  tests/workflow-writing-lines-e2e.test.mjs
```

Writing hooks regression:

```bash
node --test \
  tests/workflow-writing-hooks-policy.test.mjs \
  tests/workflow-hooks-executor.test.mjs \
  tests/workflow-file-audit-runtime-tools.test.mjs
```

---

## 12. Recommended next implementation order

最建议先做：

1. Phase A：`paper_workbench`
2. Phase C：`results_question_order`
3. Phase B：title / abstract / intro hooks
4. Phase E：language friction
5. Phase J：`innovation_synthesis` 与 `story_gap_search`
6. Phase F：venue submission profile

原因：

- A/C/B 直接对应教程最短可执行版。
- J 是 draft-post-optimization lane，解决“多个有效创新点只是堆砌”的顶会级故事线问题，并给 graph / literature 素材不足时提供额外搜索闭环。
- E/F 对最终投稿质量影响大。
- D/G/H/I 重要，但可以在前几项稳定后再加。

---

## 13. 当前框架与教程逐项映射

| 教程要求 | 当前覆盖 | 缺口 |
| --- | --- | --- |
| 一句话主张 | `paper_story_state` 部分覆盖 | 缺 `paper_workbench.one_sentence_claim` |
| 三条最强证据 | `write_package` 部分覆盖 | 缺 strongest evidence top-3 contract |
| 4-8 图表优先 | 图表预算已覆盖数量 | 缺 figure/table storyboard 和每图一句结论 |
| Results 顺序 | evidence gates 部分覆盖 | 缺 reviewer-question order |
| 5 句摘要 | abstract hook 部分覆盖 | 缺结构化 skeleton/gate |
| 5 段引言 | intro hook 部分覆盖 | 缺结构化 skeleton/gate |
| Related Work 定位 | related-work hook 部分覆盖 | 缺 strongest-baseline / fairness artifact |
| Methods trade-off | 弱覆盖 | 缺专门 hook |
| 图表高标准 | 数量 + caption hook 覆盖 | 缺自动图表生成与 claim-to-figure binding |
| 多创新点整合 | `paper_story_state` / claim map 部分覆盖 | 缺 `innovation_synthesis_state`、整合模式、story-gap search |
| 语言低摩擦 | 弱覆盖 | 缺 readability / terminology drift gate |
| 顶会/顶刊差异 | paper mode / top-tier 部分覆盖 | 缺 venue-specific checklist |
| 多作者协作 | role / task graph 部分覆盖 | 缺 author/section owner/notation contracts |
| Rebuttal | rebuttal materializer 部分覆盖 | 缺 comment-to-change map |
| 值得被记住 | 未覆盖 | 缺 memorability gate |

---

## 14. Non-goals

本方案不做：

- 不新增另一个 reviewer runtime。
- 不把所有写作判断都塞进 prompt。
- 不要求第一版 draft 就满足最终 5 图 4 表。
- 不把 figure aesthetics 自动评分作为第一阶段目标。
- 不试图为每个 venue 写死规则，先做 profile-driven checklist。
- 不在素材不足时强迫 Writer 编造统一故事线；必须允许 bounded search 或降级 contribution。

---

## 15. 总结

当前系统已经具备论文质量控制的后半段能力：

- claim/evidence
- section packets
- citation
- graph evidence
- review issue
- figure/table budget
- hooks

但要贴近教程中的顶会/顶刊写作流程，还需要补齐前半段：

```text
one-sentence claim
three strongest evidence
figure-first storyboard
innovation synthesis
story-gap search when evidence is thin
results question order
5-sentence abstract
5-paragraph introduction
method trade-off
related work fairness
language friction
venue-specific submission pack
rebuttal change map
memorability gate
```

这些应该作为 workflow-owned durable contracts 落地，而不是仅作为写作 prompt 提醒。
