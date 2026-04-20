# 当前代码 vs 顶会顶刊 Backlog 对照审计

日期：2026-04-15

目标：对照 [2026-04-15-top-tier-module-backlog.zh-CN.md](./2026-04-15-top-tier-module-backlog.zh-CN.md)，判断当前仓库：

- 哪些模块可以复用
- 哪些模块必须重构
- 哪些模块应该直接重写

结论基于当前代码实现与测试覆盖，而不是只看目录名。

---

## 总体判断

当前仓库不是“缺模块”，而是“很多关键方向已经有雏形，但实现层级不一致”。

最重要的判断有四个：

1. `workflow-guard.ts` 已经明显成为巨型 façade，必须拆。
2. `workflow-evidence/*` 的命名和 manifest 接口方向是对的，但内部大多还是 patch wrapper，不够当最终核心实现。
3. `survey-review-diagnostics.ts`、`write-package-eval.ts`、`state-recorders.ts` 这类 evaluator / recorder 已经有较强的行为价值，适合保留规则与测试，不适合原封不动保留结构。
4. 现有测试非常有价值，应该把它们当迁移护栏，而不是重构阻力。

---

## 我对当前模块的分类

### A. 可以直接复用的“行为骨架”

这些模块本身已经有较清晰的输入输出和规则密度，适合保留逻辑或保留为新子系统的核心种子。

#### 1. `survey-review-diagnostics.ts`

路径：

- `tools/survey-review-diagnostics.ts:1`

为什么可复用：

- 规则明确
- 输入输出清晰
- 已经不是单纯 prompt，而是在做可执行 gate
- 已经覆盖：
  - coverage
  - taxonomy stability
  - representative methods
  - benchmark alignment
  - gap closure

适合怎么复用：

- 作为 `research-authoring/survey-analysis/` 的基础 evaluator
- 保留判定思路，升级 schema 和 traceability，而不是推倒重来

不建议直接保留的部分：

- 当前实现仍偏 markdown keyword heuristics
- 缺 source-row traceability
- 缺 source maturity / contradiction zone / comparability layer

#### 2. `write-package-eval.ts`

路径：

- `tools/workflow-guard-writing/write-package-eval.ts:1`

为什么可复用：

- 对 writing process readiness 的建模相对清楚
- `section packet -> compile safe -> ready_for_submit` 这条逻辑值得保留

适合怎么复用：

- 作为 `research-authoring` 的 process readiness evaluator
- 在其上叠加 stronger evidence gates，而不是重写整个 process model

需要重构的点：

- 它现在更像“写作流程 readiness”，还不是“submission-grade readiness”
- 需要接入 stats / claim-evidence / figure-table registry / manuscript lint

#### 3. `paper-source-index.ts`

路径：

- `tools/paper-source-index.ts:1`

为什么可复用：

- canonical paper parsing 方向是对的
- 已经做了 title / arXiv / DOI / venue / source provider 的基础归一化
- 对 `PAPER_SOURCE_INDEX.json` 的适配比较成熟

适合怎么复用：

- 作为 `research-intel/paper-identity/` 的 parser 层和 backward-compatible reader

必须增强的点：

- 还没有 source maturity
- 还没有 canonical identity merge policy
- 还没有 venue-preferred citation policy

#### 4. citation integrity / recorder 逻辑

路径：

- `tools/workflow-guard-recorders/state-recorders.ts:1`

为什么可复用：

- `citation_integrity` 的状态字段设计是有用的
- unresolved placeholders / hallucinated citation / verificationRequired 这些概念已经很好
- 这部分已经被大量控制平面与测试消费

适合怎么复用：

- 保留 state shape 和 gating semantics
- 迁入 `research-intel/citation-audit/` 或 `research-submit/checklist-sync/`

不建议直接保留的部分：

- 当前 recorder 职责过宽，和 idle research、innovation reflection、experiment ledger 混在一个文件里

#### 5. survey / writing 相关测试

路径：

- `tests/survey-review-materializer.test.mjs:1`
- `tests/workflow-guard-writing-eval.test.mjs:1`

为什么必须保留：

- 它们已经在保护 survey mode 和 write package 的基础行为
- 这是后续重构最重要的回归护栏之一

---

### B. 适合“保行为、重构结构”的模块

这些模块不是烂掉了，而是职责已经漂移或耦合太重，不能继续作为长期架构中心。

#### 1. `workflow-guard.ts`

路径：

- `tools/workflow-guard.ts:1`

现状判断：

- 这是一个 `9279` 行的超级 façade
- 它已经同时承担：
  - stage routing
  - state normalization
  - materializer coordination
  - workflow service surface
  - prompt/runtime glue
  - evidence contract wiring

为什么必须拆：

- 代码规模已经说明职责边界失控
- 任何 top-tier 新能力继续往这里塞，后续只会更难维护
- 新 evidence 系统已经开始从这里挂进去，说明它正在变成“所有事情的入口”

稳定实现建议：

- 不直接删掉
- 先把它收缩成 `research-orchestrator facade`
- 旧 API 保持稳定
- 真正逻辑迁入新子系统

#### 2. `paper-story-materializer.ts`

路径：

- `tools/workflow-guard-materializers/paper-story-materializer.ts:1`

为什么值得保留行为：

- 它已经在做 full paper / survey 之间的写作桥接
- 它知道如何从 ideation、survey review、claim evidence 中凑出 story surface

为什么必须重构：

- 职责过多：
  - 读 manifest
  - 读很多 artifact
  - 决定 storyline source
  - 拼写作内容
  - 写回 manifest
- 它适合拆成：
  - story contract resolver
  - evidence selector
  - survey bridge
  - writer packet materializer

#### 3. `review-pressure-materializer.ts`

路径：

- `tools/workflow-guard-materializers/review-pressure-materializer.ts:1`

为什么值得保留行为：

- reject-first review
- novelty attack
- unsupported claim audit
- limitation audit

这些都是很好的 reviewer-facing bones。

为什么必须重构：

- 当前产物偏静态模板化
- 更适合升级为 `reviewer objection -> required evidence planner`
- 也就是保留这些 artifact 名义，但让背后由 evidence planner 驱动

#### 4. `workflow-guard-writing/paper-quality-eval.ts`

路径：

- `tools/workflow-guard-writing/paper-quality-eval.ts:1`

为什么保行为：

- 质量 gate 必须存在
- 这类 evaluator 是控制平面里最稳定的部分之一

为什么重构：

- 当前 paper quality、figure qc、review issue tracking 还混得太近
- 后续应拆成：
  - manuscript lint
  - evidence consistency
  - figure/table completeness
  - final audit

#### 5. `state-recorders.ts`

路径：

- `tools/workflow-guard-recorders/state-recorders.ts:1`

为什么保行为：

- recorder 这一层本身是对的
- citation verification、innovation reflection、experiment ledger 这些写入动作都需要 durable recorder

为什么重构：

- 当前单文件承担太多 recorder 职责
- 应按 domain 拆开：
  - citation recorder
  - experiment ledger recorder
  - innovation reflection recorder
  - idle research recorder

#### 6. `workflow-guard-state/*`

路径示例：

- `tools/workflow-guard-state/writing-contract.ts:1`
- `tools/workflow-guard-state/experiment-search-spec.ts:1`

为什么保留：

- 这些 normalizer/serializer 已经是 contracts 雏形
- 字段命名和兼容处理都很成熟

为什么重构：

- 还没有统一 schema version
- 没有统一 migration layer
- contract 目前分散，不足以支撑长期演进

建议：

- 不推倒
- 整体迁入 `research-contracts/`
- 做统一 adapter 和 migrator

---

### C. 应直接重写或“保接口重写内核”的模块

这些模块方向没错，但当前实现太薄，不能当最终实现。

#### 1. `workflow-evidence/benchmark-registry.ts`

路径：

- `tools/workflow-evidence/benchmark-registry.ts:1`

当前状态：

- 只是把 patch 写回 manifest
- 没有 registry object model
- 没有 protocol lock
- 没有 drift detection

判断：

- 名字和 manifest key 可以保
- 内核必须重写

#### 2. `workflow-evidence/statistics.ts`

路径：

- `tools/workflow-evidence/statistics.ts:1`

当前状态：

- 也是 manifest patch wrapper
- 没有从 `EXPERIMENT_LEDGER.json` 聚合
- 没有 CI、effect size、significance、claim confidence

判断：

- 直接重写
- 但保留 `statistical_evidence` 这组 manifest keys

#### 3. `workflow-evidence/opportunity-model.ts`

路径：

- `tools/workflow-evidence/opportunity-model.ts:1`

当前状态：

- 只是在 manifest 上记录 verdict / scorecard_path
- 没有真正的 venue opportunity model

判断：

- 方向正确
- 当前只是 state stub
- 必须按 `venue opportunity + competitor slate + kill gate` 完整重写

#### 4. `workflow-evidence/mechanism-packet.ts`

路径：

- `tools/workflow-evidence/mechanism-packet.ts:1`

当前状态：

- 同样只是 packet state patcher

判断：

- 必须重写成真正的 mechanism evidence planner + registry

#### 5. `workflow-evidence/protocol-lock.ts`

路径：

- `tools/workflow-evidence/protocol-lock.ts:1`

当前状态：

- 只是 `benchmark-registry.ts` 的别名导出

判断：

- 这个名字非常好
- 但实现上目前基本不存在
- 应作为未来正式子系统名称保留，内部重写

---

## 哪些现有设计值得作为稳定实现的锚点

### 1. manifest key 体系值得保留

这一组 key 已经深入：

- `benchmark_protocol`
- `statistical_evidence`
- `mechanism_evidence`
- `reproducibility_pack`
- `camera_ready_evidence`
- `opportunity_scorecard`

证据：

- `tools/workflow-guard.ts:91`
- `tools/workflow-guard-stages/execution-stage-signals.ts:202`
- `tools/workflow-guard-stages/writing-stage-signals.ts:140`

为什么要保：

- 已被 stage gates、snapshot builder、dashboard、team runtime 和 auto iterator 使用
- 改 manifest key 会造成大量回归

稳定策略：

- 保留 manifest key
- 升级其 schema version
- 重写生成和消费逻辑

### 2. evidence closeout 的 stage integration 值得保留

从测试和 stage profiles 看，系统已经把这些 evidence block 当作 top-tier 特殊验证节点：

- `experiment.lock_benchmark_protocol`
- `experiment.aggregate_statistics`
- `submit.camera_ready_package`

证据：

- `tests/workflow-evidence-kernel.test.mjs:1`
- `tools/workflow-team/stage-profiles.ts:92`

为什么要保：

- 这说明控制平面已经接受“顶会模式需要额外 evidence closeout”这个思想
- 我们不需要重新发明 stage 语言，只需要把其背后的实现做实

### 3. survey mode 的 section contract 值得保留

证据：

- `tools/workflow-guard-state/writing-contract.ts:13`
- `tests/survey-review-materializer.test.mjs:1`

为什么要保：

- survey section order、paper mode、proof appendix policy 这些 contract 已经比较稳定
- 这套 contract 可以直接迁入 `research-contracts/`

---

## 当前代码最需要重构的地方

### 1. 最大的重构对象：`workflow-guard.ts`

原因不是“大文件不好看”，而是它已经成为：

- contract registry
- state wiring center
- orchestration entry
- stage gate hub
- runtime bridge

这会导致：

- 任何新增顶会能力都要改这个文件
- 测试会越来越依赖隐式 wiring
- 目录再怎么拆，核心耦合还是存在

稳定重构策略：

1. 保留文件名和对外 API
2. 内部改成 thin façade
3. 让它只负责：
   - 组合依赖
   - 分发到子系统
   - 保持兼容导出

### 2. 第二大重构对象：`workflow-evidence/*`

这里的问题不是方向，而是实现层级太薄。

现在 `workflow-evidence/contracts.ts` 是值得保留的，因为它已经把 evidence state 统一命名出来了：

- `tools/workflow-evidence/contracts.ts:1`

但它对应的 materializer 基本还是：

- 读 manifest
- merge patch
- 写 manifest

这说明：

- contract 命名可复用
- materializer 实现必须重构成真正的 evidence engine

### 3. 第三大重构对象：state / recorder / materializer 的边界

现在边界问题很明显：

- state normalizer 分散在 `workflow-guard-state/*`
- recorder 分散在 `workflow-guard-recorders/*`
- materializer 分散在 `workflow-guard-materializers/*`
- write-side生成又分散在 `research-writing/*`

这在功能少的时候可接受，但在 top-tier 模式下会放大两个问题：

- 任何新 artifact 要同时改 3-4 层
- schema 变化没有统一迁移中心

稳定策略：

- 合并成 `research-contracts` + `research-evidence` + `research-authoring`
- recorder 只负责 durable writes
- materializer 只负责 derived artifacts
- evaluator 只负责 gates

---

## 哪些地方不建议大动

### 1. 不建议大改现有 manifest 语义命名

因为：

- 已经被很多测试和 runtime 依赖
- 会造成大量兼容成本

建议：

- 内部重构
- 外部字段保留

### 2. 不建议推倒 survey diagnostics

因为这部分已经很接近我们要的 survey gate，只是还不够强。

建议：

- 升级，不重写

### 3. 不建议废弃现有 tests

特别是：

- `tests/workflow-evidence-kernel.test.mjs`
- `tests/survey-review-materializer.test.mjs`
- `tests/workflow-guard-writing-eval.test.mjs`
- `tests/workflow-guard-snapshot-builder.test.mjs`
- `tests/auto-iterator.test.mjs`

这些测试应该升级为新架构的兼容护栏。

---

## 对照 backlog 的最终判断

### `TT-001` contracts 层

当前代码可复用：

- `workflow-guard-state/*`
- `workflow-evidence/contracts.ts`

需要重构：

- 增加 schema version / migration
- 统一 contract adapter

### `TT-002` / `TT-003` / `TT-006` / `TT-008`

当前代码只能复用命名和 manifest key，不能复用实现内核。

原因：

- 现有 `workflow-evidence/*.ts` 主要还是 patch wrapper

### `TT-004`

当前代码可复用：

- `claim-evidence-recorder.ts`
- `paper-story-materializer.ts` 的部分 bridge 思路

需要重构：

- claim model
- headline claim extraction
- traceability hard gate

### `TT-005`

当前代码可复用：

- `paper-source-index.ts`
- `citation_integrity` state shape

需要重构：

- canonical identity merge
- source maturity
- bibliography lint

### `TT-010`

当前代码可复用：

- `survey-review-diagnostics.ts`
- survey section contract

需要重构：

- source-row traceability
- comparability report
- contradiction zones

### `TT-011` / `TT-012` / `TT-013`

当前代码部分有 gate 概念，但缺 submission-grade 产物化。

可复用：

- `paper-quality-eval.ts`
- `figure_qc` / `paper_qc` state
- stage preflight wiring

需要重构：

- figure/table registry
- checklist sync
- final consistency audit

---

## 最稳定的实现策略

如果以“稳定实现”而不是“最小 patch”为目标，我建议这样做：

1. **保 manifest keys，不保旧内核**
   - 这是兼容收益最高的策略
2. **保 tests，不保目录结构**
   - 测试是行为资产，目录只是实现细节
3. **保 evaluator 规则，不保混杂 façade**
   - 尤其是 survey diagnostics、write-package eval、citation gate
4. **把 `workflow-evidence/*` 作为新 evidence 子系统的命名种子**
   - 但要把内部实现全部做实
5. **把 `workflow-guard.ts` 收缩成 orchestrator compatibility shell**
   - 这是长期稳定性的关键

---

## 一句话总结

当前代码库里：

- **最该保留的是规则和测试**
- **最该重构的是边界和职责**
- **最该重写的是那些已经命名正确、但实现仍然只是 manifest patch 的 evidence 模块**

这意味着我们不用“从零开始”，但也绝对不能“在现有壳子上继续堆功能”。  
最稳定的路线，是**保状态语义、保测试、重写 evidence 内核、拆掉 monolith façade**。
