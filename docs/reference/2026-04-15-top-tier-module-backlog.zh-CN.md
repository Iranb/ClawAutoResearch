# 面向顶会顶刊产出的模块级可执行 Backlog

日期：2026-04-15

适用仓库：`openclaw-research`

目标：把现有科研 workflow 从“能完成论文项目”升级为“能稳定产出顶会/顶刊 submission-grade evidence package”。

设计原则：

- 追求稳定实现，不追求最小改动。
- 必要时允许整个 `tools/` 目录做结构性重组。
- 先把 state / evidence / protocol / citation 做成硬约束，再谈更智能的写作与规划。
- 任何新能力都必须对应可持久化 artifact、明确 gate，以及自动化测试。

---

## 0. 目标架构

当前仓库的核心能力分散在：

- `tools/workflow-guard-*`
- `tools/research-writing/*`
- `tools/literature-discovery/*`
- `tools/idea-catalyst/*`
- `tools/papernexus-packets/*`
- `tools/paper-source-index.ts`

稳定版目标架构建议收敛成六个子系统：

1. `research-contracts`
   - 所有 versioned state schema、artifact schema、normalizer、serializer、migrator
2. `research-intel`
   - 文献 canonicalization、benchmark registry、venue opportunity、competitor slate
3. `research-evidence`
   - protocol lock、stats pack、claim-evidence、mechanism evidence、fair-compare
4. `research-authoring`
   - writing contract、story bridge、survey analysis、figure/table registry、manuscript lint
5. `research-submit`
   - checklist sync、repro pack、camera-ready gate、submission bundle
6. `research-orchestrator`
   - 负责 stage routing、state transitions、materializer orchestration、failure recovery

建议的目录形态：

```text
tools/
  research-contracts/
  research-intel/
  research-evidence/
  research-authoring/
  research-submit/
  research-orchestrator/
```

旧目录中的实现逐步迁入：

- `workflow-guard-state/*` -> `research-contracts/`
- `paper-source-index.ts` + literature/venue logic -> `research-intel/`
- `claim-evidence-recorder.ts` + stats/protocol/fairness -> `research-evidence/`
- `research-writing/*` + survey diagnostics -> `research-authoring/`
- submit/checklist/repro/figure QC -> `research-submit/`
- `workflow-guard-stages/*`, setters, materializers, runtime bridge -> `research-orchestrator/`

---

## 1. 顶层实施顺序

建议分四个 Program 批次推进：

### Program A. Contracts First

先统一 schema、state、artifact 版本化，解决“系统会写很多文件，但约束不够硬”的根问题。

### Program B. Evidence First

再补 benchmark / protocol / stats / claim-evidence，解决“能写稿但证据不够 reviewer-grade”的问题。

### Program C. Authoring and Submission

然后补 survey analysis、manuscript lint、figure/table registry、repro pack，解决“能写但不能稳交”的问题。

### Program D. Strategic Intelligence

最后补 venue opportunity、competitor slate、top-tier kill gate，解决“题做完了才发现不值得冲”的问题。

---

## 2. Backlog 总览

这里用 `TT-*` 编号，便于直接转 issue / project board。

| ID | 标题 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| TT-001 | 建立 versioned research contracts 基础层 | P0 | 无 |
| TT-002 | 重构 benchmark registry 与 protocol lock 子系统 | P0 | TT-001 |
| TT-003 | 建立 statistical evidence pipeline | P0 | TT-001, TT-002 |
| TT-004 | 重构 claim-evidence hard gate | P0 | TT-001, TT-003 |
| TT-005 | 建立 canonical paper identity 与 bibliography audit | P0 | TT-001 |
| TT-006 | 建立 top-tier bet / venue opportunity kill gate | P0 | TT-005 |
| TT-007 | 重构 review pressure 为 objection-driven evidence planner | P1 | TT-003, TT-004, TT-006 |
| TT-008 | 建立 mechanism evidence templates 与 registry | P1 | TT-003, TT-004 |
| TT-009 | 建立 same-backbone / same-protocol fair-compare engine | P1 | TT-002, TT-003, TT-005 |
| TT-010 | 将 survey pipeline 升级为 critical-analysis pipeline | P1 | TT-005, TT-009 |
| TT-011 | 建立 figure/table registry 与 camera-ready gate | P1 | TT-004 |
| TT-012 | 建立 submission reproducibility pack | P1 | TT-002, TT-003, TT-011 |
| TT-013 | 建立 manuscript lint 与 consistency audit | P1 | TT-004, TT-005, TT-011 |
| TT-014 | 建立 negative-result / rejected-path memory | P2 | TT-004, TT-007 |
| TT-015 | 收敛 `tools/` 目录为六大子系统 | P2 | TT-001 到 TT-013 |

---

## 3. 模块级改造清单

### TT-001. 建立 versioned research contracts 基础层

#### 为什么先做

现在大量 state 以 ad hoc normalizer 存在于：

- `tools/workflow-guard-state/*`
- `tools/workflow-guard-recorders/*`
- `tools/research-writing/*`

这种方式能工作，但不适合大规模演化。顶会/顶刊级系统需要强 schema、版本迁移、显式兼容。

#### 改造目标

建立统一 contracts 层：

- 所有 state/packet 都有 schema version
- 所有 schema 有 normalize / serialize / migrate
- 所有 materializer 都消费 versioned contract，而不是 loose record

#### 目录改造

新增：

- `tools/research-contracts/core/`
- `tools/research-contracts/artifacts/`
- `tools/research-contracts/state/`
- `tools/research-contracts/migrations/`

迁入：

- `workflow-guard-state/*`
- `writing-contract.ts`
- `paper-story.ts`
- `review-pressure.ts`
- `survey-review.ts`
- `experiment-search-spec.ts`

#### 具体任务

1. 为每个现有 state 定义显式 contract type。
2. 给每个 contract 加 `schema_version`。
3. 写统一 `normalizeContract / serializeContract / migrateContract` 工具。
4. 禁止其他模块直接操作 raw manifest record。
5. 所有 materializer 仅消费 contract adapter。

#### 需要新增测试

- `tests/research-contracts-schema-version.test.mjs`
- `tests/research-contracts-migration.test.mjs`
- `tests/research-contracts-roundtrip.test.mjs`

#### 验收标准

- 所有核心 state 都可 round-trip
- 老 manifest 可自动迁移
- 任何新模块都不能再直接使用 loose `Record<string, unknown>` 作为长期接口

---

### TT-002. 重构 benchmark registry 与 protocol lock 子系统

#### 目标

把 protocol 从 hint 变成 lock。

#### 当前相关模块

- `tools/workflow-guard-state/experiment-search-spec.ts`
- `tools/workflow-projection/dashboard-summary.ts`
- `tools/research-writing/materializers.ts`

#### 新目录

- `tools/research-intel/benchmark-registry/`
- `tools/research-evidence/protocol-lock/`

#### 新 artifact

- `researcher/BENCHMARK_REGISTRY.json`
- `researcher/PROTOCOL_LOCK.json`
- `researcher/BASELINE_FAIRNESS_REPORT.json`

#### 具体任务

1. 设计 benchmark canonical object：
   - dataset
   - split
   - metric
   - evaluation harness
   - allowed variants
   - fair-comparison notes
2. 把 `locked_dataset_protocol`、`locked_metric_protocol`、`locked_evaluation_harness` 升级为真实 lock。
3. 在 experiment creation 阶段强制写 `PROTOCOL_LOCK.json`。
4. 在 analyze/review/write 阶段检查 lock 一致性。
5. 增加 protocol drift detector。

#### 需要修改的旧模块

- `tools/workflow-guard-stages/execution-stage-signals.ts`
- `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- `tools/workflow-guard-writing/write-package-eval.ts`

#### 新测试

- `tests/benchmark-registry-contract.test.mjs`
- `tests/protocol-lock-drift-detection.test.mjs`
- `tests/baseline-fairness-gate.test.mjs`

#### 验收标准

- 主结果没有 protocol lock 就不能 mature
- 任何跨方法比较都带 explicit fairness label

---

### TT-003. 建立 statistical evidence pipeline

#### 目标

把 multi-seed 从“状态字段”变成“提交证据包”。

#### 新目录

- `tools/research-evidence/stats/`
- `tools/research-evidence/claim-confidence/`

#### 新 artifact

- `analyzer/STATISTICAL_EVIDENCE_PACKET.json`
- `analyzer/STATISTICAL_EVIDENCE_SUMMARY.md`
- `analyzer/CLAIM_CONFIDENCE_MAP.json`

#### 具体任务

1. 从 `EXPERIMENT_LEDGER.json` 聚合多 seed / 多 split 结果。
2. 自动生成：
   - mean/std
   - CI
   - significance
   - effect size
   - per-seed table
3. 为 claim 计算 confidence level。
4. 给 writer 提供 conservative wording API。
5. checklist、abstract、results 共用同一统计源。

#### 需要修改的旧模块

- `tools/workflow-guard-recorders/claim-evidence-recorder.ts`
- `tools/workflow-guard-writing/paper-quality-eval.ts`
- `tools/research-writing/section-scorer.ts`

#### 新测试

- `tests/statistical-evidence-materializer.test.mjs`
- `tests/claim-confidence-map.test.mjs`
- `tests/checklist-stat-sync.test.mjs`

#### 验收标准

- 不再允许正文与 checklist 统计冲突
- 没有统计支撑的主 claim 自动降级

---

### TT-004. 重构 claim-evidence hard gate

#### 目标

把现在相对宽松的 claim-evidence 体系改成顶级投稿可用的强 gate。

#### 当前相关模块

- `tools/workflow-guard-recorders/claim-evidence-recorder.ts`
- `tools/workflow-guard-materializers/paper-story-materializer.ts`
- `tools/research-writing/story-bridge.ts`

#### 新目录

- `tools/research-evidence/claim-map/`
- `tools/research-evidence/evidence-gates/`

#### 新 artifact

- `analyzer/CLAIM_EVIDENCE_MATRIX.v2.json`
- `analyzer/CLAIM_EVIDENCE_AUDIT.md`
- `analyzer/UNVERIFIED_CLAIMS.json`

#### 具体任务

1. 重新定义 claim object：
   - claim id
   - claim text
   - claim strength
   - benchmark scope
   - evidence ids
   - statistical support
   - limitations
2. abstract / intro / conclusion 自动抽取 headline claim。
3. 统一 reconciliation，不再依赖“>=2 supporting experiments 才算 supported”这种过粗规则。
4. 支持 claim -> evidence -> figure/table -> checklist 全链路回指。

#### 新测试

- `tests/claim-evidence-hard-gate.test.mjs`
- `tests/abstract-claim-traceability.test.mjs`
- `tests/conclusion-claim-traceability.test.mjs`

#### 验收标准

- headline claim 100% 可回指
- writer 无法绕过 evidence gate 直接写强 claim

---

### TT-005. 建立 canonical paper identity 与 bibliography audit

#### 当前相关模块

- `tools/paper-source-index.ts`
- `tools/workflow-guard-recorders/state-recorders.ts`
- `tools/research-writing/reference-bundles.ts`

#### 目标

解决：

- Placeholder
- 错 venue
- 错题目
- 正式论文被写成 arXiv
- 综述 quantitative claim 不能回指 source row

#### 新目录

- `tools/research-intel/paper-identity/`
- `tools/research-intel/citation-audit/`
- `tools/research-intel/source-maturity/`

#### 新 artifact

- `researcher/PAPER_IDENTITY_REGISTRY.json`
- `researcher/CITATION_AUDIT_REPORT.json`
- `researcher/BIBLIOGRAPHY_MATURITY_REPORT.md`

#### 具体任务

1. 扩展 `paper-source-index.ts` 为 canonical identity registry。
2. 增加 source maturity：
   - venue_published
   - openreview_accepted
   - arxiv_only
   - uncertain
3. bibliography lint：
   - placeholder detection
   - venue mismatch
   - duplicate identity mismatch
4. survey / related work 写作只允许消费 canonical identity。

#### 新测试

- `tests/paper-identity-registry.test.mjs`
- `tests/citation-audit-placeholder.test.mjs`
- `tests/citation-audit-venue-mismatch.test.mjs`

#### 验收标准

- bibliography 中 `Placeholder` 为 0
- 已正式发表条目不再被降级成 arXiv-only

---

### TT-006. 建立 top-tier bet / venue opportunity kill gate

#### 当前相关模块

- `tools/idea-catalyst/*`
- `tools/literature-discovery/*`
- `skills/orchestrator/plan-research/SKILL.md`

#### 目标

在项目一开始就判断：

- 值不值得冲 top-tier
- 最适合哪个 venue
- 最近最强竞争者是谁

#### 新目录

- `tools/research-intel/venue-opportunity/`
- `tools/research-intel/competitor-slate/`
- `tools/research-intel/problem-market-fit/`

#### 新 artifact

- `planner/VENUE_OPPORTUNITY_SCORECARD.md`
- `planner/CLOSEST_COMPETITOR_SLATE.md`
- `planner/TOP_TIER_BET_DECISION.json`

#### 具体任务

1. 为题目建立 opportunity score：
   - timeliness
   - crowding
   - novelty delta
   - venue fit
   - evidence difficulty
2. 对 closest papers 建 competitor slate。
3. 生成：
   - publishable
   - strong conference
   - top-tier bet
   - not worth top-tier

#### 新测试

- `tests/venue-opportunity-scorecard.test.mjs`
- `tests/competitor-slate-generation.test.mjs`
- `tests/top-tier-bet-kill-gate.test.mjs`

#### 验收标准

- 项目在进入大规模实验前已有 top-tier 决策

---

### TT-007. 重构 review pressure 为 objection-driven evidence planner

#### 当前相关模块

- `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- `tools/workflow-guard-writing/paper-quality-eval.ts`

#### 目标

让 review 不只是发现问题，而是自动派生缺失证据包。

#### 新目录

- `tools/research-evidence/reviewer-objections/`
- `tools/research-evidence/evidence-planner/`

#### 新 artifact

- `analyzer/REVIEWER_OBJECTION_MAP.json`
- `planner/REQUIRED_EVIDENCE_BUNDLE.json`

#### 具体任务

1. 把 objection 分类：
   - protocol artifact
   - weak stats
   - no mechanism evidence
   - unfair baseline
   - backbone confound
   - weak novelty
2. 每类 objection 映射到 required experiment / artifact set。
3. review round 自动产出待补清单。

#### 新测试

- `tests/reviewer-objection-mapping.test.mjs`
- `tests/review-pressure-evidence-planner.test.mjs`

#### 验收标准

- review 输出从“问题清单”升级为“补证据执行单”

---

### TT-008. 建立 mechanism evidence templates 与 registry

#### 当前相关模块

- `skills/analyzer/scientific-figures/*`
- `skills/analyzer/analyze-results/SKILL.md`
- `tools/research-writing/figure-anchor.ts`

#### 目标

将“为什么有效”的证据模板化。

#### 新目录

- `tools/research-evidence/mechanism-templates/`
- `tools/research-evidence/figure-registry/`

#### 新 artifact

- `analyzer/MECHANISM_EVIDENCE_REGISTRY.json`
- `analyzer/MECHANISM_EVIDENCE_PLAN.md`

#### 具体任务

1. 定义 method family -> mechanism evidence 模板。
2. 自动建议需要的图：
   - frequency map
   - attention region map
   - prototype drift
   - cluster quality
   - modality contribution
3. 把 mechanism evidence 接入 claim gate。

#### 新测试

- `tests/mechanism-evidence-template.test.mjs`
- `tests/mechanism-figure-registry.test.mjs`

#### 验收标准

- discussion 里的 mechanism 不再只是猜测

---

### TT-009. 建立 same-backbone / same-protocol fair-compare engine

#### 当前相关模块

- `tools/survey-review-diagnostics.ts`
- `tools/research-writing/materializers.ts`

#### 目标

解决 survey 和方法稿里最常见的 apples-to-oranges 问题。

#### 新目录

- `tools/research-evidence/fair-compare/`
- `tools/research-authoring/comparison-normalizer/`

#### 新 artifact

- `analyzer/FAIR_COMPARE_MATRIX.json`
- `academic_writer/COMPARE_WARNINGS.md`

#### 具体任务

1. 把每个对比结果归类：
   - same backbone / same protocol
   - same benchmark but backbone confounded
   - weakly comparable
   - not comparable
2. survey 写作自动插入 comparison warning。
3. full paper results section自动引用 fair-compare label。

#### 新测试

- `tests/fair-compare-engine.test.mjs`
- `tests/survey-compare-warning.test.mjs`

#### 验收标准

- 系统不会再默认把不公平对比写成统一 ranking

---

### TT-010. 将 survey pipeline 升级为 critical-analysis pipeline

#### 当前相关模块

- `tools/survey-review-diagnostics.ts`
- `tools/research-writing/materializers.ts`
- `tests/survey-review-materializer.test.mjs`

#### 目标

从“会写 survey”升级到“会做顶刊级 analysis”。

#### 新目录

- `tools/research-authoring/survey-analysis/`
- `tools/research-authoring/sota-matrix/`

#### 新 artifact

- `researcher/SOTA_MATRIX.v2.json`
- `researcher/SOURCE_TO_CLAIM_INDEX.json`
- `academic_writer/SURVEY_COMPARABILITY_REPORT.md`
- `academic_writer/CONTRADICTION_ZONES.md`

#### 具体任务

1. survey matrix 改为强 schema。
2. quantitative claim 必须回指 matrix row。
3. 增加 contradiction zone 检测。
4. 增加 source maturity and venue coverage diagnostics。
5. 增加 survey self-limitation generator。

#### 新测试

- `tests/survey-analysis-matrix.test.mjs`
- `tests/survey-claim-source-traceability.test.mjs`
- `tests/survey-contradiction-zones.test.mjs`

#### 验收标准

- survey 的 quantitative synthesis 可被追溯和审计

---

### TT-011. 建立 figure/table registry 与 camera-ready gate

#### 当前相关模块

- `tools/research-writing/figure-anchor.ts`
- `tools/workflow-guard-writing/write-package-eval.ts`
- `tools/workflow-guard-writing/paper-quality-eval.ts`

#### 目标

杜绝：

- `Table ??`
- `Figure ??`
- 图表存在但不支撑 claim

#### 新目录

- `tools/research-authoring/figure-table-registry/`
- `tools/research-submit/camera-ready-gates/`

#### 新 artifact

- `academic_writer/FIGURE_REGISTRY.json`
- `academic_writer/TABLE_REGISTRY.json`
- `academic_writer/CAMERA_READY_AUDIT.json`

#### 具体任务

1. 为每个 figure/table 建唯一 ID。
2. 绑定 supporting claims。
3. 提交前扫 unresolved placeholders。
4. appendix figure completeness audit。

#### 新测试

- `tests/figure-table-registry.test.mjs`
- `tests/camera-ready-placeholder-audit.test.mjs`

#### 验收标准

- unresolved placeholder 数量必须为 0

---

### TT-012. 建立 submission reproducibility pack

#### 当前相关模块

- `tools/workflow-guard-recorders/*`
- `tools/workflow-guard-runtime/*`

#### 目标

让 supplementary 和 checklist 不再临时手工拼。

#### 新目录

- `tools/research-submit/repro-pack/`
- `tools/research-submit/checklist-sync/`

#### 新 artifact

- `submit/REPRO_PACK.json`
- `submit/HARDWARE_AND_RUNTIME.md`
- `submit/CHECKLIST_SYNC_REPORT.json`

#### 具体任务

1. 从 ledger、runtime、manifest 收集：
   - seeds
   - environment
   - hardware
   - run commands
   - checkpoints
2. 自动生成 checklist supporting evidence。
3. supplementary 镜像主文关键事实。

#### 新测试

- `tests/repro-pack-materializer.test.mjs`
- `tests/checklist-sync-report.test.mjs`

#### 验收标准

- supplementary 可以由系统自动生成第一版

---

### TT-013. 建立 manuscript lint 与 consistency audit

#### 目标

专门抓自动生成和拼稿痕迹。

#### 新目录

- `tools/research-authoring/manuscript-lint/`
- `tools/research-submit/final-audit/`

#### 新 artifact

- `academic_writer/MANUSCRIPT_LINT_REPORT.json`
- `submit/FINAL_CONSISTENCY_AUDIT.md`

#### 规则集

- title / abstract / intro / conclusion 名称一致性
- benchmark count 一致性
- method family naming consistency
- checklist-body consistency
- bibliography maturity consistency
- unresolved references / tables / figures

#### 新测试

- `tests/manuscript-lint-consistency.test.mjs`
- `tests/final-consistency-audit.test.mjs`

#### 验收标准

- 论文不会再出现“像多份草稿拼接”的痕迹

---

### TT-014. 建立 negative-result / rejected-path memory

#### 目标

减少重复探索和无效迭代。

#### 新目录

- `tools/research-intel/rejected-path-memory/`

#### 新 artifact

- `researcher/REJECTED_HYPOTHESES.json`
- `researcher/NEGATIVE_RESULT_MEMORY.md`

#### 具体任务

1. 把 failed ablations 结构化记录。
2. 把被 review kill 掉的故事线显式记录。
3. 进入下一轮 ideation 时主动读取 rejected memory。

#### 新测试

- `tests/rejected-path-memory.test.mjs`

#### 验收标准

- 后续 agent 不会再次建议已经证伪的旧方向

---

### TT-015. 收敛 `tools/` 目录为六大子系统

#### 目标

减少当前 `workflow-guard-*` 与 `research-writing/*` 的职责漂移。

#### 迁移策略

1. 先新增新目录，不马上删旧目录。
2. 在旧模块里建立 thin compatibility adapters。
3. 新代码只写入新目录。
4. 待覆盖测试后，再删旧实现。

#### 必需子任务

1. 建立迁移地图：
   - old path
   - new path
   - removal phase
2. 对外导出层稳定：
   - 旧 API 保持兼容一段时间
3. 所有测试逐步从旧模块导入切到新模块导入

#### 新测试

- `tests/repo-module-migration-map.test.mjs`
- `tests/compat-adapter-stability.test.mjs`

#### 验收标准

- 目录边界清晰
- materializer / recorder / evaluator 不再跨域互相侵入

---

## 4. 推荐的实施节奏

### Milestone 1. 可信度基础设施

范围：

- TT-001
- TT-002
- TT-003
- TT-004
- TT-005

验收：

- 主结果全部 protocol locked
- 主 claim 全部 traceable
- bibliography 无 placeholder
- stats packet 可自动生成

### Milestone 2. 竞争力基础设施

范围：

- TT-006
- TT-007
- TT-008
- TT-009

验收：

- 每个新项目都能给 top-tier bet 判断
- review 能自动反推出缺失证据包
- full paper / survey 都具备 fair-compare warnings

### Milestone 3. 投稿级产物基础设施

范围：

- TT-010
- TT-011
- TT-012
- TT-013

验收：

- survey quantitative claims 可回指 source row
- 无 unresolved figure/table placeholders
- submission checklist 与主文一致
- reproducibility pack 自动生成

### Milestone 4. 结构收敛与长期记忆

范围：

- TT-014
- TT-015

验收：

- 目录结构稳定
- 负结果和拒绝路径能跨 session 重用

---

## 5. 必须同步重构的测试面

当前测试很多，这是好事，但要明确哪些必须跟着 backlog 一起升级。

### 优先保留并扩展

- `tests/workflow-guard-paper-quality-eval.test.mjs`
- `tests/workflow-guard-writing-eval.test.mjs`
- `tests/research-writing-integration.test.mjs`
- `tests/survey-review-materializer.test.mjs`
- `tests/writing-contract-modes.test.mjs`
- `tests/citation-calibration.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`

### 需要新增的纵向 e2e

新增三条真正代表顶会/顶刊生产能力的 e2e：

1. `tests/top-tier-full-paper-e2e.test.mjs`
   - 从 problem selection 到 submission bundle
2. `tests/top-tier-survey-e2e.test.mjs`
   - 从 survey review 到 critical-analysis draft
3. `tests/final-submission-audit-e2e.test.mjs`
   - 从 manuscript 到 final consistency audit

---

## 6. 迁移风险与控制

### 风险 1. 重构期间 state 兼容断裂

应对：

- 所有 contract 都做 versioned migration
- 旧 manifest 一律先 migrate 再读取

### 风险 2. 新旧模块并存导致职责更混乱

应对：

- 新目录只负责新增能力
- 旧模块只做 compatibility adapter，不再扩展

### 风险 3. 测试数量多，迁移成本高

应对：

- 先保行为测试
- 再切目录导入
- 最后删旧模块

### 风险 4. 系统更严格后，短期内更多项目会被 gate 卡住

应对：

- 这是预期行为
- 目标不是让系统更“顺滑”，而是更“可信”

---

## 7. 我会怎么开工

如果要按最稳定的方式推进，而不是最小 patch，我建议实际落地顺序是：

1. 先做 `TT-001`，把 contracts 层立住。
2. 然后立刻做 `TT-002` + `TT-003`。
3. 接着做 `TT-004` + `TT-005`，把证据和引用都卡硬。
4. 再做 `TT-006` 到 `TT-009`，把系统从执行型升级成竞争型。
5. 最后做 `TT-010` 到 `TT-015`，把 survey、submission、目录收敛完。

这是最稳的路线，因为它优先修的是系统可信度，而不是界面体验或 prompt 细节。

---

## 8. 最终判断

如果这份 backlog 执行到位，系统会发生三个质变：

1. 从“能把科研流程跑完”变成“能把证据做硬”
2. 从“能生成论文草稿”变成“能生成 submission package”
3. 从“能做项目”变成“能筛选值得冲 top-tier 的项目”

这才是顶会顶刊级论文系统和普通自动科研系统的真正分界线。
