# openclaw-research 下一阶段实施计划

**日期：** 2026-04-03  
**作者：** Codex  
**范围：** 仅针对 `openclaw-research` 仓库本身的下一阶段改动，不包含 PaperNexus 底层 KG/schema 实现。  
**关联文档：**

- `docs/superpowers/plans/2026-04-03-openclaw-research-system-status-summary.zh-CN.md`
- `docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`
- `docs/superpowers/plans/2026-04-03-idea-catalyst-kg-subpipeline.md`
- `/workspace/internal/artifacts/functional_audit_v2.md.resolved`

---

## 0. 脱离聊天上下文时必须先知道的事实

这份计划不是从零开始。继续实现前，必须先接受下面这些“当前事实”：

### 0.1 现有 workflow 主干已经存在且可运行

当前系统已经有完整阶段机：

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`

并且已经有：

- project-local runtime queue/session/outbox/recovery
- `auto_iterator`
- `/workflow-status`
- `research_program / orchestration_state / write_package`
- `ideation_contract / paper_story_state / review_pressure_packet`
- workflow-owned PaperNexus upload / graph verify / repair

因此后续工作**不是再搭一套新 workflow**，而是在现有 workflow 上补强 IDEA-CATALYST 和 Evo 风格的高阶闭环。

### 0.2 IDEA-CATALYST 在 openclaw-research 里已经有第一版实现

以下模块已经存在，不能当成“待新建文件”来处理：

- `tools/idea-catalyst/state.ts`
- `tools/idea-catalyst/packets.ts`
- `tools/idea-catalyst/decomposer.ts`
- `tools/idea-catalyst/translator.ts`
- `tools/idea-catalyst/scout-adapter.ts`
- `tools/idea-catalyst/gatekeeper.ts`
- `tools/idea-catalyst/integrator.ts`
- `tools/idea-catalyst/judge.ts`
- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/ranking.ts`
- `tools/idea-catalyst/workflow-bridge.ts`

这些模块已经做到了：

- `PROJECT_MANIFEST.json.idea_catalyst` 的 durable state
- catalyst packet 路径管理
- `materialize_idea_catalyst_state`
- 基于 graph ideation artifact 的 decomposition / abstraction / scouting / gate / fragments / ranking 产物脚手架
- requisition 的第一版结构化输出

### 0.3 当前已经接线到 workflow 的入口

下面这些接线已经存在：

- `tools/register-workflow-tools.ts`
  - 已注册：
    - `get_idea_catalyst_state`
    - `set_idea_catalyst_state`
    - `materialize_idea_catalyst_state`
- `tools/workflow-guard-runtime/stage-preflight.ts`
  - 已有 catalyst materialization preflight
- `tools/workflow-guard-stages/ideation-stage-signals.ts`
  - 已有 catalyst 缺失信号与阶段逻辑
- `tools/workflow-guard-runtime/auto-iterator.ts`
  - 已能显示和使用 catalyst micro-stage
- `tools/workflow-commands/formatters.ts`
  - 已能在 `/workflow-status` 中显示 catalyst 状态

所以实现下一阶段工作时，重点应是**增强这些模块和 contract**，而不是重新选择新的接线位置。

### 0.4 当前已有测试

至少已有这些测试与 IDEA-CATALYST 直接相关：

- `tests/idea-catalyst-runtime-tools.test.mjs`
- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/evo-skill-alignment.test.mjs`

这些测试已经覆盖了：

- catalyst state materialization
- preflight 自动补齐
- `/workflow-status` 可见性
- catalyst skill 注册
- 部分 requisition 生成行为

因此后续改动时应遵循：

- 先扩这些测试
- 再改实现
- 不要绕开现有测试入口另写一套平行验证

### 0.5 当前最重要的边界约束

1. **不要把新业务逻辑堆回 `workflow-guard.ts`**
2. **不要在 `openclaw-research` 里复制一套 PaperNexus KG 逻辑**
3. **不要新增平行的 ideation memory 系统**
4. **优先复用已有的 graph-backed artifact 与 durable state**
5. **任何 catalyst 产物都应能回写现有合同，而不是漂浮在独立目录里没人消费**

---

## 1. 目标

在不继续把大量业务逻辑堆回 `workflow-guard.ts` 的前提下，完成 `openclaw-research` 侧剩余的高价值工作，使系统具备更完整的：

1. IDEA-CATALYST IDEA 子流水线控制能力
2. graph-native requisition -> ingestion -> rerun 的 workflow 闭环
3. Evo 风格的创新设计、故事线、评审回压
4. 多项目与 runtime 层面的后续自治强化

本计划默认前提：

- PaperNexus 侧会继续补 domain / mechanism / bridge KG primitive
- `openclaw-research` 只消费稳定 contract，不在本仓库内复制一套 KG 逻辑

---

## 2. 当前边界

### 2.1 `openclaw-research` 应负责的内容

- workflow 阶段机与微阶段编排
- durable contract 与项目状态
- stage preflight / gate / materializer
- agent/skill/runtime tool 接线
- requisition 闭环的 workflow-owned orchestration
- `/workflow-status`、prompt、route、handoff、review pressure 的整合

### 2.2 `openclaw-research` 不应负责的内容

- Domain taxonomy 设计本体
- Abstract mechanism KG schema
- domain-distance 基础算法
- cross-domain bridge 图查询底层实现
- semantic extraction 写回 domain/mechanism 元数据的底层 pipeline

这些应由 PaperNexus 侧提供 contract，再由本仓库接入。

### 2.3 当前 `openclaw-research` 已经依赖的 PaperNexus contract

在写任何 openclaw-research 侧逻辑前，需要把当前对 PaperNexus 的依赖看成“外部 contract”：

- `fieldOfStudy`
- `fieldCandidates`
- `domainTags`
- `abstractMechanisms`
- `candidateDomains`
- `bridgeNodes`
- `mechanismMatches`

当前这些 contract 已经在 PaperNexus 第一版代码中出现，但还未完全稳定。因此本仓库的 adapter 设计必须：

- 接受 contract 继续演进
- 避免把字段名和算法硬编码到多个地方

---

## 2.4 当前 openclaw-research 里还没做完的关键空洞

下面这些是“真实未完成项”，不是泛泛而谈的愿望清单：

1. **Decomposer 还没有真正做 per-question coverage classification**
   - 目前更像是 graph artifact 驱动的 packet scaffolding
   - 还没到 `resolved | partial | unexplored` 的强版本
2. **Scout 仍偏 bridge-heuristic，而不是强 bridge-native selection**
3. **Gatekeeper 还没有把 requisition 完整变成 workflow-owned reentry loop**
4. **Judge 有 ranking helper，但还不算完整的 pairwise evaluator loop**
5. **Catalyst packet 与 `ideation_contract` 的联动还不够强**
6. **`plan/code/experiment/analyze` 对 catalyst 与 proposal 的反向消费仍不够严格**
7. **writer/reviewer 虽有合同，但 story-first 自动流还不够“强结构化”**

---

## 3. 总体实施策略

### 3.1 原则

1. **优先复用现有模块结构**
   - 优先放在：
     - `tools/idea-catalyst/`
     - `tools/workflow-guard-runtime/`
     - `tools/workflow-guard-stages/`
     - `tools/workflow-guard-guidance/`
     - `tools/workflow-commands/`
2. **薄化 `workflow-guard.ts`**
   - 只保留 facade、组装、兼容出口
   - 不再向其中回灌成段业务逻辑
3. **workflow-owned，不依赖 agent 自觉维护状态**
   - Catalyst packet、story/review pressure、requisition loop 必须由 workflow 显式驱动
4. **PaperNexus adapter-first**
   - 先面向 contract 编程
   - 底层 KG schema 的增强由 PaperNexus 单独演进

### 3.2 优先级

- **P0：** IDEA-CATALYST workflow 闭环
- **P1：** Evo 风格 writer/reviewer 自动流强化
- **P2：** runtime/multi-project 后续自治

---

## 4. Task A：完成 IDEA-CATALYST 子流水线的 workflow 闭环

### 4.1 目标

把当前“已接线但未完全毕业”的 IDEA-CATALYST，推进为正式、稳定、可回退、可重进的 IDEA 子流水线。

### 4.2 当前已有基础

- `tools/idea-catalyst/*` 已存在
- catalyst state 已存在
- catalyst packet 已存在
- `workflow-status` 已能显示 catalyst 状态
- Scout/Gatekeeper/requisition loop 已有第一版
- `templates/PROJECT_MANIFEST.json` 已含 `idea_catalyst`
- `tests/idea-catalyst-runtime-tools.test.mjs` 已覆盖基础 materialization

### 4.3 仍需补完的点

1. Decomposer 的 per-question coverage contract
2. Translator 的 mechanism-quality contract
3. Scout 的 bridge evidence 消费与 source-domain pruning
4. Gatekeeper 的 sufficiency / requisition policy 稳定化
5. Integrator 的 fragment schema 收紧
6. Judge 的 pairwise / Elo-style judging 稳定化

### 4.3.1 这里不要重做的内容

以下内容已经有第一版，不要推倒重来：

- `IdeaCatalystState` 的字段与路径约定
- catalyst packet 默认存放路径
- `materializeIdeaCatalystState(...)` 的 workflow tool 入口
- `/workflow-status` 的 catalyst 可见性
- catalyst skill bundle 注册

### 4.3.2 建议的具体实现顺序

1. 先增强 `decomposer.ts`
   - 引入 per-question 结构
   - 每个问题写出 coverage/status
   - 保留向后兼容的 packet 形状
2. 再增强 `translator.ts`
   - 从“换种表述”升级到“机制抽象与迁移接口”
3. 再增强 `scout-adapter.ts`
   - 让它优先消费 PaperNexus 的 bridge/domain contract
   - 降低自由文本猜测成分
4. 再增强 `gatekeeper.ts`
   - 让其输出更强的 sufficiency/requisition reason
5. 最后增强 `judge.ts`
   - 从单次分数汇总，升级为 pairwise / Elo-style aggregation

### 4.3.3 需要同步更新的测试

- `tests/idea-catalyst-runtime-tools.test.mjs`
- `tests/auto-iterator.test.mjs`
- 如涉及状态显示，再补 `tests/workflow-commands.test.mjs`

### 4.4 文件建议

- `tools/idea-catalyst/state.ts`
- `tools/idea-catalyst/packets.ts`
- `tools/idea-catalyst/decomposer.ts`
- `tools/idea-catalyst/translator.ts`
- `tools/idea-catalyst/scout-adapter.ts`
- `tools/idea-catalyst/gatekeeper.ts`
- `tools/idea-catalyst/integrator.ts`
- `tools/idea-catalyst/judge.ts`
- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/workflow-bridge.ts`
- `tools/workflow-guard-stages/ideation-stage-signals.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-guidance/idea-catalyst-guidance.ts`

### 4.5 完成标准

- IDEA 阶段能明确显示 catalyst 微阶段
- 缺失 packet 时阻塞准确
- packet ready 时可以稳定进入 `plan`
- catalyst packet 与 `ideation_contract` 保持同步
- 不需要把大段逻辑塞回 `workflow-guard.ts`

---

## 5. Task B：把 requisition -> ingestion -> graph refresh -> IDEA rerun 做成 workflow-owned 闭环

### 5.1 目标

让 Gatekeeper 发出的 investigation requisition 不再只是一个“建议动作”，而成为真正可执行的 workflow 闭环。

理想链条：

`Gatekeeper -> Investigation Requisition -> queue_paper_ingestion -> graph_build/uploading -> graph_build/verifying -> frontier refresh / idea rerun`

### 5.1.1 当前真实状态

目前这条链已经有“前半段结构”，但还不是完整闭环：

- `gatekeeper.ts` 已能产出 requisition
- `materializers.ts` 已能把 requisition 写到 `INVESTIGATION_REQUISITION.json`
- `workflow-bridge.ts` 已能生成 requisition blocking signal
- `auto_iterator` 已能感知 catalyst 微阶段

但仍缺：

- requisition 到 `paper_ingestion.queued_requests` 的正式桥接
- graph sync 完成后的稳定重入 IDEA
- retry budget / saturation 防止来回震荡

### 5.2 需要完成的能力

1. requisition 状态持久化
2. requisition 到 `paper_ingestion.queued_requests` 的桥接
3. graph_build repair / verify 与 catalyst 请求的关联
4. 成功补料后自动重进 IDEA 阶段
5. 避免无限循环，增加 retry budget / saturation signal

### 5.2.1 具体建议

建议不要把这条闭环埋在单个 agent prompt 里，而是拆成 3 层：

1. `idea-catalyst/workflow-bridge.ts`
   - 负责把 requisition 解释成 workflow action
2. `workflow-fast-paths.ts` / `register-workflow-tools.ts`
   - 负责把 action 变成 queued ingestion request
3. `auto-iterator.ts`
   - 负责在 graph ready 后重入 IDEA

### 5.2.2 完成闭环时应新增的显式状态

建议新增或补强这些字段，而不是靠文本判断：

- `idea_catalyst.requisition_required`
- `idea_catalyst.pending_reason`
- `idea_catalyst.last_requisition_cycle`
- `idea_catalyst.requisition_retry_budget`
- `idea_catalyst.requisition_saturated`

如果不想改 manifest 主结构，也至少要保证 session packet 或 bridge helper 中能稳定反映这些状态。

### 5.3 文件建议

- `tools/idea-catalyst/workflow-bridge.ts`
- `tools/workflow-fast-paths.ts`
- `tools/workflow-background-pool.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/workflow-guard-stages/foundation-stage-signals.ts`
- `tools/workflow-commands/formatters.ts`
- `tools/register-workflow-tools.ts`

### 5.4 完成标准

- requisition 不是静态文档，而是 durable workflow action
- `workflow-status` 能显示 requisition 数量、状态、最近一次回流
- 补料成功后能回到 IDEA 子流水线，而非停在孤立 repair 状态

---

## 6. Task C：继续补 Evo 风格的 `plan -> code -> experiment -> analyze` 约束闭环

### 6.1 目标

把已有的 `ideation_contract / paper_story_state / review_pressure_packet` 从“已有 durable state”推进到“真正约束实现和验证”。

### 6.2 需要补强的点

1. `plan` 更强依赖 `RESEARCH_PROPOSAL.md` / `PROBLEM_DECOMPOSITION.md`
2. `code` 更强依赖 `CLAIM_TO_EXPERIMENT_MAP.md`
3. `experiment` / `analyze` 更稳定回写 claim support / limitation / failure-case
4. 将 unsupported / partial claim 的严重度更细化

### 6.2.1 当前真实状态

这条链不是从零开始：

- `paper_story_state` 已存在
- `review_pressure_packet` 已存在
- `paper_story_materializer.ts` 与 `review-pressure-materializer.ts` 已存在
- `stage-preflight.ts` 已能自动 materialize

因此下一步不该再做“有没有这些 state”，而该做：

- 让它们更强地约束 `plan/code/experiment/analyze`
- 让 analyzer 结果更可靠地回写 story/review 合同

### 6.3 文件建议

- `tools/workflow-guard-materializers/paper-story-materializer.ts`
- `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- `tools/workflow-guard-state/paper-story.ts`
- `tools/workflow-guard-state/review-pressure.ts`
- `skills/orchestrator/plan-research/SKILL.md`
- `skills/coder/implement-experiment/SKILL.md`
- `skills/analyzer/analyze-results/SKILL.md`
- `agents/coder/AGENTS.md`
- `agents/coder/SOUL.md`

### 6.4 完成标准

- code/experiment 不再只是“有 bundle 就能过”
- story/state 与实际实验支持度有更强的一致性
- 后续 write/review 使用的是已回写的事实，而非自由文本总结

---

## 7. Task D：继续补 writer / reviewer 的 story-first 自动流

### 7.1 目标

让写作和评审更接近 EvoScientist / EvoSkills 的“故事线骨架先行、证据链回压、对抗式自审”。

### 7.2 需要补强的点

1. writer 更强消费：
   - story spine
   - pipeline figure sketch
   - module motivation mapping
   - claim-to-experiment map
   - fallback narrative
   - rejection-risk table
2. reviewer 更强生成：
   - reject-first simulation
   - novelty attack
   - unsupported claim audit
   - reverse outline
   - limitation audit

### 7.2.1 当前真实状态

这部分已经有基础：

- writer/reviewer runtime state 已完成
- `paper_story_state` 与 `review_pressure_packet` 已存在
- `paper-review` skill 已存在

真正缺的不是“有没有 reviewer”，而是：

- 是否把 reviewer 的结构化攻击结果稳定写回 contract
- 是否让 writer 在进入写作前强制消化这些结构化约束

### 7.3 文件建议

- `skills/academic_writer/paper-plan/SKILL.md`
- `skills/academic_writer/paper-write/SKILL.md`
- `skills/reviewer/review-phase/SKILL.md`
- `skills/reviewer/paper-review/SKILL.md`
- `agents/academic_writer/AGENTS.md`
- `agents/reviewer/AGENTS.md`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-guidance/writing-guidance.ts`

### 7.4 完成标准

- writer 在进入成稿前有真正的 story-first preflight
- reviewer 不只是泛 critique，而是带结构化攻击包
- `paper_story_state` 与 `review_pressure_packet` 不只是 ready，而是内容更有区分度

---

## 8. Task E：继续收口 workflow-guard facade

### 8.1 目标

在不破坏现有对外接口的前提下，继续把 `workflow-guard.ts` 收口为薄 facade。

### 8.2 后续拆分方向

1. 剩余 facade glue
2. 仍偏重的 project-state I/O 汇总
3. 剩余 prompt/state assembly glue
4. 仍留在 facade 中的少量 summary/router logic

### 8.2.1 当前真实状态

`workflow-guard.ts` 已经不是原始大单文件，但仍然保留很多 facade glue。后续拆分时要遵循：

- **改子模块优先**
- **只有 export 兼容或依赖注入时才碰 facade**
- **不在 facade 中重新实现业务**

### 8.3 文件建议

- `tools/workflow-guard.ts`
- `tools/workflow-guard-project-state.ts`
- `tools/workflow-guard-prompt-assembly.ts`
- `tools/workflow-guard-prompt-support.ts`
- `tools/workflow-guard-collaboration.ts`

### 8.4 完成标准

- `workflow-guard.ts` 更接近 barrel/facade，而不是事实上的大总线
- 新逻辑默认落到子模块，不再回流主文件

---

## 9. Task F：runtime 与多项目自治的后续增强

### 9.1 目标

在主 runtime rewrite 已完成的基础上，继续补多项目与恢复能力。

### 9.2 需要补强的点

1. `done -> switch_project` 自动切换闭环
2. 更强的 session reattachment / restart recovery
3. 更强的 durable replay / idempotent recovery
4. 更完整的 E2E portfolio-style integration test

### 9.2.1 当前真实状态

当前 runtime rewrite 主合同已经完成，而且已有完整单项目 `setup -> ... -> done` E2E 测试。  
所以这部分不是“修主 runtime”，而是补：

- 多项目切换
- 更深的恢复
- 更复杂的自治轮转

### 9.3 文件建议

- `tools/workflow-session-orchestrator.ts`
- `tools/workflow-runtime-recovery.ts`
- `tools/workflow-announce-runtime.ts`
- `tools/register-workflow-service.ts`
- `tests/workflow-runtime-orchestrator.test.mjs`
- `tests/auto-iterator.test.mjs`

### 9.4 完成标准

- 单项目闭环之外，多项目轮转也能自动推进
- crash/restart 后恢复行为更可预期

---

## 10. 推荐执行顺序

1. **Task A**：完成 IDEA-CATALYST 子流水线控制环
2. **Task B**：完成 requisition -> ingestion -> rerun 闭环
3. **Task C**：补强 plan/code/experiment/analyze 强约束
4. **Task D**：补 writer/reviewer story-first 自动流
5. **Task E**：继续收口 `workflow-guard.ts`
6. **Task F**：补多项目自治与更强 recovery

---

## 11. 验证建议

每完成一项后，至少跑对应的最小测试集：

- IDEA/CATALYST：
  - `node --test tests/idea-catalyst-runtime-tools.test.mjs tests/auto-iterator.test.mjs`
- workflow/runtime：
  - `node --test tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-commands.test.mjs`
- build：
  - `npm run build`

当 requisition 闭环完成后，建议额外补一条：

- `setup -> graph_build -> frontier_mapping -> idea(catalyst requisition) -> graph_build -> idea -> plan`

的 E2E integration test。

### 11.1 当前建议的最小回归组合

如果 Claude 或其他 agent 只想先做一个 task，建议至少跑：

- `node --test tests/idea-catalyst-runtime-tools.test.mjs tests/auto-iterator.test.mjs`
- `node --test tests/workflow-runtime-tools.test.mjs tests/workflow-commands.test.mjs`
- `npm run build`

如果改到了 writer/reviewer：

- `node --test tests/evo-skill-alignment.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs`

---

## 11.2 推荐给接手 agent 的工作方式

接手实现时建议按这个顺序操作，而不是直接盲改：

1. 先读：
   - `docs/superpowers/plans/2026-04-03-openclaw-research-system-status-summary.zh-CN.md`
   - `docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`
   - 当前这份 plan
2. 再看：
   - `tools/idea-catalyst/*`
   - `tools/workflow-guard-runtime/stage-preflight.ts`
   - `tools/workflow-guard-stages/ideation-stage-signals.ts`
   - `tests/idea-catalyst-runtime-tools.test.mjs`
3. 先扩测试，再改实现
4. 优先在子模块里改，不要默认去改 `workflow-guard.ts`

---

## 12. 一句话总结

`openclaw-research` 下一阶段的重点，不再是把基础 workflow 从 0 搭起来，而是：

**把现有 durable workflow、graph-first ideation、story/review contracts 三者真正收敛成一条更强的 IDEA-CATALYST 驱动科研闭环。**
