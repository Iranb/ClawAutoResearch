# 面向顶会顶刊论文产出的系统级优化路线图

日期：2026-04-15

适用对象：`openclaw-research` 当前科研工作流系统

## 一句话结论

当前系统已经是一个“像样的科研生产系统”，但还不是一个“稳定产出顶会顶刊论文的系统”。

最关键的差距不在：

- 再多几个 agent
- 再多一层 prompt
- 再多一点自动写作

而在下面这几个更硬的层面：

- benchmark / protocol 锁定
- 统计证据 materialization
- venue-aware 竞争定位
- reviewer-objection 驱动的 ablation 设计
- bibliography / citation 的可审计性
- survey / full paper 两条产线的证据约束
- 图表、附录、复现包的 camera-ready 完整性
- problem selection 的 top-tier kill gate

换句话说，系统现在强在“把事情推进下去”，但还不够强在“把事情推进到审稿人很难拒掉”。

## 现状判断

基于仓库里已有的模块与文档，系统已经具备不错的骨架：

- `paper_story_state`
- `review_pressure_packet`
- `writing_contract`
- `citation_integrity`
- `survey-review-diagnostics`
- `EXPERIMENT_LEDGER.json`
- survey-mode writing line

说明问题不是“没有 pipeline”，而是 pipeline 还没有把 top-tier 最难的最后一公里产品化。

## 目标状态

如果目标是“显著提高产出顶会/顶刊论文的概率”，系统应该升级成下面这种形态：

1. 在选题阶段就知道这是不是值得冲 top-tier 的问题。
2. 在实验阶段就锁死 benchmark / split / metric / baseline fairness。
3. 在分析阶段自动生成 reviewer-grade 统计证据，而不是只生成 narrative。
4. 在 review 阶段不是泛泛挑问题，而是针对 reviewer objection 自动拉出缺失实验和机制证据。
5. 在写作阶段任何 claim 都能回指到可核验的 artifact。
6. 在 submit 前自动做 bibliography / figure / appendix / reproducibility 级别的完整性审计。

## 细粒度优化方向

### P0. 建立第一类公民的 Benchmark Registry

这是最优先的系统改造。

#### 当前缺口

系统已经有一些 protocol 相关字段，例如：

- `locked_dataset_protocol`
- `locked_metric_protocol`
- `manifest.benchmark_protocol`

但这些还不够形成真正的 benchmark lock。

#### 要补什么

为每个 benchmark 建立 canonical registry，至少包含：

- benchmark family
- dataset version / checksum
- split protocol
- evaluation script
- metric definition
- allowed protocol variants
- strongest accepted baselines
- fair-comparison notes

#### 建议落点

- `tools/workflow-guard-state/`
- `tools/workflow-guard-stages/`
- `tools/workflow-guard-materializers/`
- `tools/workflow-guard-writing/`

#### 需要新增的系统能力

- `BENCHMARK_REGISTRY.json`
- `PROTOCOL_LOCK.json`
- protocol drift detector
- benchmark-aware review gate

#### 成功标准

- 同一项目下，任何实验结果都能回溯到唯一 protocol lock
- review 时能自动指出“这个结果不能直接和某 baseline 比”
- survey 写作时能自动标记“fair compare / shaky compare / not comparable”

### P0. 建立统计证据流水线，而不是只记录 multi-seed 状态

#### 当前缺口

系统知道 multi-seed 很重要，但还没有把它 materialize 成可投论文证据。

#### 要补什么

新增统计证据层，自动生成：

- mean / std / CI
- effect size
- significance tests
- per-seed table
- claim-strength label

#### 建议落点

- `tools/research-writing/`
- `tools/workflow-guard-writing/`
- `tools/workflow-guard-recorders/`
- `tools/workflow-guard-materializers/`

#### 建议新增 artifact

- `STATISTICAL_EVIDENCE_PACKET.json`
- `STATISTICAL_EVIDENCE_SUMMARY.md`
- `CLAIM_CONFIDENCE_MAP.json`

#### 需要的 gate

- 如果主 claim 只有 single run，不允许 mature/full-ready
- 如果 improvement 落在 CI 内且不显著，claim wording 自动降级
- checklist 与主文的统计结论必须一致，否则直接 fail

#### 成功标准

- 不再出现“正文写 p=0.15，checklist 写 p<0.001”这种冲突
- writer 不需要手动编统计句子，系统自动提供 reviewer-safe wording

### P0. 建立 Claim-Evidence Hard Gate

#### 当前缺口

现在系统已经有 `paper_story_state`、claim-evidence artifacts 和 unsupported claim audit，但强度还不够。

#### 要补什么

让每个 headline claim 必须绑定：

- evidence artifact
- benchmark scope
- statistical support
- baseline scope
- limitations note

#### 建议落点

- `tools/research-writing/materializers.ts`
- `tools/workflow-guard-writing/`
- `tools/workflow-guard-materializers/`

#### 需要新增检查

- abstract / intro / conclusion 里的每个 strong claim 都要落到 matrix
- 没证据或证据弱的 claim 自动降级为 tentative wording
- 跨段落重复 claim 要共享同一 evidence id

#### 成功标准

- writer 不能再“自由发挥”
- paper 从 narrative-first 变成 evidence-first

### P0. 建立 Citation Canonicalization 与 Bibliography 审计

#### 当前缺口

虽然系统已经有 citation integrity state，但从实际产出看，仍会出现：

- Placeholder
- 错 venue
- 错标题
- 正式会议论文被写成 arXiv preprint

#### 要补什么

建立 canonical paper identity 层，至少包含：

- title
- authors
- venue
- year
- DOI / OpenReview / OpenAccess / arXiv
- publication maturity

#### 建议落点

- `tools/paper-source-index.ts`
- `tools/workflow-guard-recorders/state-recorders.ts`
- `tools/research-writing/reference-bundles.ts`

#### 建议新增 gate

- bibliography 中出现 `Placeholder` 直接 fail
- 已存在正式 venue 的条目，默认不允许退化成 arXiv-only citation
- summary / survey 中如果引用未核验来源，自动打 unresolved flag

#### 成功标准

- 综述稿不会再出现文献卫生问题
- 相关工作和对标结论的可信度显著上升

### P0. 建立 Top-Tier 问题选择的 Kill Gate

#### 当前缺口

系统现在很擅长把一个选中的题目做下去，但还不够擅长判断“这题值不值得冲顶会/顶刊”。

#### 要补什么

在 ideation / plan 阶段加入 problem-market-fit 评估：

- 社区是否 care this cycle
- 最近 12-18 个月是否已有更强方法
- 这个问题是 benchmark cleanup 级，还是 field-moving 级
- 该 venue 是否奖励这类贡献

#### 建议落点

- `tools/idea-catalyst/`
- `tools/literature-discovery/`
- `tools/graph-presence.ts`
- `skills/orchestrator/plan-research/SKILL.md`

#### 建议新增 artifact

- `VENUE_OPPORTUNITY_SCORECARD.md`
- `TOP_TIER_BET_DECISION.json`
- `CLOSEST_COMPETITOR_SLATE.md`

#### 成功标准

- 系统能明确告诉你“这是一个能做完的题”还是“这是一个值得冲 top-tier 的题”
- 减少大量“写得很完整，但本质不值得投顶会”的低效项目

### P1. 建立 Venue-Competitive Novelty Scorecard

#### 当前缺口

现在 novelty 检查更像“有没有类似工作”，而不是“和最近最强 3-5 篇相比，我到底强不强”。

#### 要补什么

把 novelty 从 graph-aware 升级为 acceptance-aware：

- closest competitor slate
- claim delta matrix
- venue-specific novelty bar
- likely reviewer objection list

#### 建议落点

- `tools/literature-discovery/`
- `tools/research-writing/venue-routing.ts`
- `tools/workflow-guard-guidance/`

#### 成功标准

- 每个项目都知道自己是：
  - incremental but publishable
  - strong conference contender
  - top-tier contender
  - not worth top-tier bet

### P1. 建立 Reviewer Objection -> Required Experiment 映射

#### 当前缺口

现在 review pressure 比较强，但还不够“操作化”。

#### 要补什么

建立 objection-driven experiment planner：

- objection: “gain may be protocol artifact”
  - required: protocol-controlled baseline rerun
- objection: “mechanism not isolated”
  - required: mechanism ablation set
- objection: “only one seed”
  - required: statistical confirmation pack
- objection: “backbone confound”
  - required: same-backbone compare

#### 建议落点

- `tools/workflow-guard-writing/`
- `tools/workflow-guard-stages/`
- `tools/research-writing/`

#### 成功标准

- review 不再只是给问题，而是直接反推出缺失实验包
- ablation 不再是 checklist 驱动，而是 reviewer-risk 驱动

### P1. 建立 Mechanism Evidence Layer

#### 当前缺口

很多方法稿目前能给出“结果更好”，但不能给出“为什么有效”的硬证据。

#### 要补什么

针对不同论文类型建立 mechanism evidence 模板：

- frequency-based method
  - frequency visualization
  - filter activation analysis
- attention-based method
  - token / region saliency shifts
  - object/background focus contrast
- prototype-based method
  - prototype drift
  - cluster compactness / separation
- multi-modal method
  - modality contribution / failure slices

#### 建议落点

- `skills/analyzer/analyze-results/SKILL.md`
- `skills/analyzer/scientific-figures/`
- `tools/research-writing/`

#### 成功标准

- discussion 不再只是 speculative hypothesis
- mechanism 章节变成 reviewer 更难否掉的证据面

### P1. 建立 Same-Backbone / Same-Protocol 归一化比较层

#### 当前缺口

当前系统在 survey 和方法稿里都容易把：

- method gain
- backbone gain
- data/protocol gain

混在一起。

#### 要补什么

建立 normalized comparison layer：

- same-backbone table
- same-protocol table
- cross-backbone table
- fairness warnings

#### 建议落点

- `tools/survey-review-diagnostics.ts`
- `tools/research-writing/materializers.ts`
- `tools/workflow-guard-writing/`

#### 成功标准

- survey 不再把 DINOv2 / CLIP 的收益误写成方法族的收益
- full paper 不再因为 baseline fairness 被 reviewer 一票否决

### P1. 把 Survey 线路从“能写”升级到“能做 analysis”

#### 当前缺口

当前 survey 线路已经有不错的骨架，但更像 structured survey，不像顶刊级 critical analysis。

#### 要补什么

让 survey 系统强制产出：

- canonical SOTA matrix
- benchmark alignment table
- coverage gaps by family / venue / year
- contradictory-results table
- maturity labels for sources

#### 建议落点

- `tools/survey-review-diagnostics.ts`
- `tools/research-writing/materializers.ts`
- `researcher/` survey artifacts

#### 需要新增 gate

- 没有 matrix 就不允许 mature survey draft
- benchmark/metric/backbone 不显式对齐则不给 ready
- survey 中的 quantitative claim 必须能回指到 source row

#### 成功标准

- survey 产物更接近 IJCV/TPAMI 风格的 critical synthesis
- 不再只是“把 14 篇论文写成一篇长文”

### P1. 建立 Figure/Table Camera-Ready Materialization

#### 当前缺口

现在系统已经能提醒 figure QC，但还不够保证：

- every claim has a table/figure landing zone
- appendix visuals complete
- no `Table ??` / `Figure ??`

#### 要补什么

新增图表层：

- figure registry
- table registry
- unresolved placeholder detector
- camera-ready completeness gate

#### 建议落点

- `tools/research-writing/`
- `tools/workflow-guard-writing/`
- `skills/analyzer/scientific-figures/`

#### 成功标准

- 提交前不会再出现占位符残留
- 图表不只是存在，而是和 claim spine 一一对应

### P1. 建立 Release-Grade Reproducibility Pack

#### 当前缺口

系统已经有 experiment ledger 和 runtime memory，但还没形成“可以随稿一起交”的 reproducibility pack。

#### 要补什么

- exact environment snapshot
- run manifest
- seeds / hardware / training time
- model / checkpoint provenance
- evaluation commands
- supplementary checklist mirror

#### 建议落点

- `tools/workflow-guard-recorders/`
- `tools/workflow-guard-runtime/`
- `tools/workflow-guard-project/`

#### 成功标准

- supplementary 不再临时手工补
- reviewer 的“能不能复现”质疑更容易正面应对

### P2. 建立 Negative Result / Risk Memory

#### 当前缺口

系统现在更善于积累成功路径，不够善于积累“哪些方向已经证伪，不必再试”。

#### 要补什么

- failed ablation memory
- rejected hypothesis memory
- protocol pitfalls memory
- venue rejection pattern memory

#### 建议落点

- `.omx/project-memory.json`
- `INNOVATION_REFLECTION.md`
- `review_pressure_packet`

#### 成功标准

- 后续 agent 不会重复探索已经被证伪的路线
- commit / project memory 更像组织知识，而不是临时缓存

### P2. 建立 Draft Lint，专门抓“自动生成痕迹”

#### 当前缺口

从实际论文产出看，当前系统还会漏掉一些非常伤审稿信任的痕迹：

- inconsistent method names
- inconsistent benchmark counts
- checklist 与正文冲突
- unresolved placeholders
- speculative claims stronger than evidence

#### 要补什么

做一个 manuscript lint 层，专门检查：

- title / abstract / intro / conclusion consistency
- section-level number consistency
- bibliography maturity consistency
- checklist-body consistency

#### 建议落点

- `tools/workflow-guard-writing/`
- `tools/research-writing/`

#### 成功标准

- 产出不会再出现“像拼稿”或“像 AI 拼接”的痕迹

## 建议的实现顺序

如果只能分阶段做，我建议按下面顺序推进。

### 第一阶段：先补“可信度基础设施”

1. Benchmark registry + protocol lock
2. Statistical evidence packet
3. Claim-evidence hard gate
4. Bibliography / citation canonicalization

这一阶段的目标不是“写得更漂亮”，而是“先不要被 reviewer 一眼看穿漏洞”。

### 第二阶段：再补“竞争力基础设施”

5. Venue opportunity scorecard
6. Competitor slate + novelty scorecard
7. Objection-driven experiment mapping
8. Mechanism evidence templates

这一阶段的目标是把系统从“能完成项目”变成“能冲有竞争力的项目”。

### 第三阶段：最后补“camera-ready 基础设施”

9. Survey analysis upgrade
10. Figure/table registry
11. Reproducibility pack
12. Draft lint + final consistency audit

这一阶段的目标是把系统从“会写稿”变成“会交稿”。

## 一套可执行的系统 KPI

为了避免优化方向停留在口号，建议用下面这些指标衡量系统升级是否真的有效：

- protocol-locked experiment ratio
  - 目标：所有主结果 100% protocol locked
- claim-evidence traceability ratio
  - 目标：摘要/引言/结论的强 claim 100% 可回指
- verified citation ratio
  - 目标：正文 citations 100% verified，0 placeholder
- same-backbone fair-compare coverage
  - 目标：主方法论文至少 1 组 same-backbone fair compare
- statistical support coverage
  - 目标：主 claim 100% 具备 multi-seed or justified exception
- unresolved placeholder count
  - 目标：提交前必须为 0
- survey matrix coverage
  - 目标：每篇综述核心定量结论都能回指到 matrix row
- top-tier bet kill precision
  - 目标：减少“做完才发现题不值得投顶会”的项目比例

## 最后判断

如果你问“当前系统最应该补哪一刀”，我的答案是：

- 第一刀砍 `benchmark / protocol / statistics / citation`
- 第二刀砍 `venue-aware positioning / objection-driven experiments`
- 第三刀砍 `camera-ready artifact completeness`

因为顶会顶刊论文不是“更长的文本”，而是：

- 更难被质疑的 evidence package
- 更清楚的 comparative positioning
- 更完整的 submission-grade artifact set

当前系统已经有不错的控制平面；下一步不应该主要增加“写作自由度”，而应该增加“证据约束强度”。
