# openclaw-research 系统现状与后续改进综述

**日期：** 2026-04-03  
**作者：** Codex  
**语言：** 中文  
**范围：** 基于当前仓库实现、`docs/superpowers/plans/` 下现有计划、`IDEA_CATALYST_MultiAgent_Blueprint.md`、以及功能审查文件，对 `openclaw-research` 的系统现状、已具备功能、未完成项与后续修改方向做一次统一梳理。

---

## 1. 信息来源

本综述主要基于以下材料：

1. 功能审查：
   - `/workspace/internal/artifacts/functional_audit_v2.md.resolved`
2. 当前核心计划：
   - `docs/superpowers/plans/2026-03-26-workflow-runtime-state.md`
   - `docs/superpowers/plans/2026-03-26-workflow-runtime-state-phase-2.md`
   - `docs/superpowers/plans/2026-03-26-workflow-control-plane-phase-3.md`
   - `docs/superpowers/plans/2026-03-26-workflow-p0-p1-hardening.md`
   - `docs/superpowers/plans/2026-03-31-workflow-runtime-rewrite-sessions-spawn.md`
   - `docs/superpowers/plans/2026-04-01-papernexus-batch-graph-sync.md`
   - `docs/superpowers/plans/2026-04-02-evo-inspired-ideation-story-workflow.md`
   - `docs/superpowers/plans/2026-04-02-workflow-guard-modularization.md`
   - `docs/superpowers/plans/2026-04-02-workflow-plugin-subagent-avoidance.md`
   - `docs/superpowers/plans/2026-04-03-idea-catalyst-kg-subpipeline.md`
3. IDEA-CATALYST 蓝图：
   - `docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`
4. 当前代码结构与模块分层：
   - `tools/workflow-guard-*`
   - `tools/idea-catalyst/*`
   - `tools/workflow-background-pool.ts`
   - `tools/workflow-session-orchestrator.ts`
   - `tools/workflow-runtime-state.ts`
   - `tools/workflow-announce-runtime.ts`
   - `tools/workflow-trace.ts`

---

## 2. 总体结论

### 2.1 当前系统已经不再是“概念性 workflow”

`openclaw-research` 现在已经具备一套相当完整的科研自动化骨架：

- 有明确的阶段机：
  `setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`
- 有 durable 的项目状态：
  以 `PROJECT_MANIFEST.json` 为事实源，辅以 runtime state、trace、outbox、queue、session、ledger 等项目内文件
- 有自动推进机制：
  `auto_iterator`、service coordinator、runtime orchestrator、announce/broadcast/recovery
- 有较强的写作与审查约束：
  writing session、review session、citation integrity、write package、review pressure packet、paper story state、claim/evidence 约束
- 有 graph-first 的研究链：
  论文收集、PaperNexus 图同步、graph presence check、frontier mapping、graph-grounded ideation

因此，从“系统是否已经形成完整科研流水线”这个问题来看，答案是：**是的，已经形成，而且主干功能已具备较强可用性。**

### 2.2 当前最大的差距已经不在基础 workflow，而在更高阶的“研究智能”

当前系统真正还不够完善的地方，主要集中在：

- IDEA-CATALYST 还未达到 blueprint 中要求的完整 metacognitive / KG-native control loop
- PaperNexus 的 domain / abstract mechanism / cross-domain bridge schema 还只是早期地基，不是最终版本
- 多项目自治与更深层 crash recovery 还有提升空间
- `workflow-guard.ts` 虽然已大幅拆分，但 facade 仍偏大，尚未收敛到“非常薄的入口层”

换句话说：

- **workflow 基础设施** 已经很强
- **研究创新生成能力** 和 **知识图谱驱动的跨域推理** 仍是最值得继续投资的部分

---

## 3. 目前系统已经具备的核心能力

## 3.1 Workflow 控制平面与阶段机

当前系统已经具备以下能力：

- 阶段机、前后阶段关系、所有者路由、阻塞原因、下一步动作建议
- durable `research_program`
- durable `orchestration_state`
- durable `write_package`
- stage gate 与 missing-signal 体系
- `/workflow-status` 的摘要输出
- prompt layering / focused payload / prompt trace metadata

这部分主要对应并基本兑现了以下计划：

- `2026-03-26-workflow-runtime-state.md`
- `2026-03-26-workflow-runtime-state-phase-2.md`
- `2026-03-26-workflow-control-plane-phase-3.md`

其中：

- `workflow-runtime-state` 与 `phase-2` 这两条计划可视为**已完成并已落地**
- `control-plane-phase-3` 标记为 `COMPLETE`，当前代码状态与该判断基本一致

## 3.2 Runtime rewrite 与持久化执行层

运行时主计划 `2026-03-31-workflow-runtime-rewrite-sessions-spawn.md` 的主合同已经基本实现：

- project-local runtime queue
- project-local runtime session persistence
- announce outbox
- broadcast outbox
- recovery helper
- session/orchestrator durable binding
- project-local `workflow-events.jsonl`
- project-local `workflow-trace.jsonl`
- legacy project migration
- 完整 `setup -> ... -> done` 生命周期 E2E 测试

这意味着当前系统已经从“临时派发型 workflow”进化为：

**以项目目录为边界的 durable workflow runtime。**

这部分是当前系统最成熟、最工程化的能力之一。

## 3.3 PaperNexus 图同步与 graph-first research loop

图同步相关能力目前已经具备：

- workflow-owned PaperNexus 上传/同步
- queued ingestion request
- batch import wrapper 驱动的 graph sync
- `graph presence` 验证
- `graph_build/uploading -> verifying -> brainstorm_refresh` 微阶段
- graph repair 状态与 repair loop
- `graph_build` 不再要求过早存在 `brainstorm_cycle`
- Zotero 项目级 `bot/<project-id>` 同步口径

这部分主要承接：

- `2026-04-01-papernexus-batch-graph-sync.md`
- 图同步 repair / workflow-owned upload 的后续实现

当前结论：

- 图同步已经不再依赖 Researcher 自己充当上传执行器
- 上传与图验证的主控制权已经转移到 workflow/runtime
- Researcher 更适合专注在筛选、解释、创新设计和图上 reasoning

## 3.4 写作、评审、质量控制与写作运行时

当前系统已经具备比较完整的写作与审查 runtime：

- `writing_session`
- `review_session`
- `graph_guided_writing`
- `citation_integrity`
- `paper_qc`
- `figure_qc`
- `review_issue_tracker`
- `write_package`
- `paper_story_state`
- `review_pressure_packet`

并且已经建立起下列强约束：

- `WRITE -> SUBMIT` 必须满足写作、引用、review issue、write package 等条件
- claim 与 evidence 之间存在显式约束
- unsupported claim 会阻塞后续推进
- paper story 与 review pressure 可以 workflow-owned materialize

这部分已经明显吸收了 EvoScientist / EvoSkills 的方法论，只是还没有把所有细节完全结构化到底。

## 3.5 Evo-inspired ideation / story / review 合同

当前系统已经具备三套核心合同：

- `ideation_contract`
- `paper_story_state`
- `review_pressure_packet`

并已具备：

- manifest 持久化
- workflow tools 读写
- `/workflow-status` 摘要输出
- preflight 自动 materialize
- stage gate 约束
- 与 graph-backed memory 的复用

这意味着系统已经不只是“Brainstorm 一下，然后直接写计划”，而是开始把：

- 创新设计
- 论文故事线
- 评审压力测试

变成持续维护的 durable state。

## 3.6 workflow-guard 模块化已经取得明显进展

虽然 `workflow-guard.ts` 仍然很长，但它已经不是原来的“全部逻辑都堆在一个文件里”的状态了。

当前已经拆出的正式模块包括：

- `tools/workflow-guard-core/*`
- `tools/workflow-guard-state/*`
- `tools/workflow-guard-stages/*`
- `tools/workflow-guard-materializers/*`
- `tools/workflow-guard-guidance/*`
- `tools/workflow-guard-summaries/*`
- `tools/workflow-guard-recorders/*`
- `tools/workflow-guard-runtime/*`
- `tools/workflow-background-pool.ts`
- `tools/workflow-guard-project-state.ts`
- `tools/workflow-guard-experiment-history.ts`
- `tools/workflow-guard-collaboration.ts`
- `tools/workflow-guard-prompt-assembly.ts`
- `tools/workflow-guard-prompt-support.ts`

因此，`workflow-guard` 的模块化已经从“想法”变成“现实中的分层结构”，只是 facade 仍然偏厚。

## 3.7 IDEA-CATALYST 已经进入“正式接线但未完全毕业”的状态

当前系统已经不只是有一个 `pn_idea_catalyst.py` 脚本，而是有正式的模块与子流水线接入：

- `tools/idea-catalyst/decomposer.ts`
- `tools/idea-catalyst/translator.ts`
- `tools/idea-catalyst/scout-adapter.ts`
- `tools/idea-catalyst/gatekeeper.ts`
- `tools/idea-catalyst/integrator.ts`
- `tools/idea-catalyst/judge.ts`
- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/ranking.ts`
- `tools/idea-catalyst/workflow-bridge.ts`
- `tools/idea-catalyst/state.ts`
- `tools/idea-catalyst/packets.ts`

并且已经具备：

- catalyst state 持久化
- catalyst packet 路径和状态显示
- IDEA 阶段内的 catalyst-aware micro-stage / signal
- catalyst skill bundle
- graph-native Scout / Gatekeeper / requisition loop 的第一版

这说明 IDEA-CATALYST 已经被纳入现有 workflow 架构，而不是停留在文档层面。

---

## 4. 现有计划项的大致完成情况

## 4.1 已完成或基本完成

以下计划可以视为“已实现主合同”：

- `2026-03-26-workflow-runtime-state.md`
- `2026-03-26-workflow-runtime-state-phase-2.md`
- `2026-03-26-workflow-control-plane-phase-3.md`
- `2026-03-31-workflow-runtime-rewrite-sessions-spawn.md`
- `2026-04-01-papernexus-batch-graph-sync.md`
- `2026-04-02-workflow-plugin-subagent-avoidance.md`

说明：

- 这些计划中个别文档可能没有逐项打到最终百分之百，但从实现层面看，主能力已经存在并可用。

## 4.2 部分完成

以下计划属于“已经落了不少，但仍未完全闭环”：

- `2026-03-26-workflow-p0-p1-hardening.md`
- `2026-04-02-evo-inspired-ideation-story-workflow.md`
- `2026-04-02-workflow-guard-modularization.md`
- `2026-04-03-idea-catalyst-kg-subpipeline.md`
- `IDEA_CATALYST_MultiAgent_Blueprint.md`

这些计划的共同特点是：

- 架构方向已基本确定
- 主骨架已经接线
- 但仍然缺少若干“最后一公里”的严格闭环或最终收口

## 4.3 仍处于草稿或方向性推进

最典型的是：

- `2026-04-02-evo-inspired-ideation-story-workflow.md`

它已经有不少实现成果，但文档仍然标成“草稿”，这意味着：

- 实现推进已经超过了文档状态本身
- 后续需要继续回写和收口，避免“代码比计划走得快，文档反而失真”

---

## 5. 基于审查文件的对照：哪些问题已经修复，哪些仍然有效

## 5.1 已经修复或已明显过时的问题

以下审查项，在当前代码状态下已不再是主要问题：

### 1. graph_build 过早要求 brainstorm_cycle

审查认为：

- `graph_build` 不应要求 `brainstorm_cycle`

当前状态：

- **已修复**

这条现在不应再作为未解决问题来对待。

### 2. 无最大回退深度

审查认为：

- regression loop 可能一路退回 `setup`

当前状态：

- **已修复**

### 3. 从 submit 回退时 gate timestamp 未清理

当前状态：

- **已修复**

### 4. 背景 registry/queue 使用 `/tmp`

当前状态：

- **已修复**
- 当前关键 runtime state 已迁移为 project-local

### 5. PaperNexus skill 文档仍教 raw REST

当前状态：

- **大体已修复**
- wrapper-first / queue-first 口径已经成为主线

### 6. review pressure packet 仅被要求、不会自动生成

当前状态：

- **已修复**
- 当前已有 materializer + stage preflight 自动补齐链

### 7. theory support 对所有项目一刀切

当前状态：

- **已修复**
- 已按 `proof_appendix_required` 条件化

## 5.2 仍然部分成立、值得继续关注的问题

### 1. crash recovery / durable outbox / persistent session binding 的“理想终态”尚未完全到位

当前状态不是“没做”，而是：

- 主 runtime rewrite 已实现
- 但更深层运维韧性仍有继续硬化空间

因此审查里关于 runtime hardening 的判断：

- **部分成立**

### 2. IDEA 阶段仍未完全达到 KG-native / bridge-native 设计目标

当前状态：

- 已有第一版图驱动 Scout / Gatekeeper
- 已有 catalyst state 与子流水线
- 但尚未达到 blueprint 中强调的：
  - 完整 domain taxonomy
  - domain distance contract
  - abstract mechanism traversal
  - structural analogy detection
  - 更强的 pairwise judging

因此审查关于 “IDEA 仍偏 heuristic” 的判断：

- **仍成立，但程度已经下降**

### 3. done -> next project 自动切换尚未完全闭环

从架构上看，系统已经能表达 `switch_project` 类型的后继动作，但多项目自治轮转是否已经形成完整自动闭环，仍然不是当前系统的强项。

因此这条审查意见：

- **仍然值得保留**

## 5.3 优先级较低或已经不属于当前主矛盾的问题

例如：

- service broadcast timing 的细碎 race
- 个别计划文件与实际进度不同步
- 某些低价值文档漂移

这些问题并不是没有意义，但相较于：

- IDEA-CATALYST 图谱能力
- 跨域桥接能力
- 更完整的 metacognitive control loop

它们已不再是最值得优先解决的主矛盾。

---

## 6. 当前系统还不完善的地方

## 6.1 PaperNexus KG/schema 还没有达到 blueprint 目标

这是当前最明显的“能力上限”约束。

仍然缺少或尚不稳定的能力：

- 统一且最终确定的 domain taxonomy
- 稳定的 domain-distance helper / contract
- 真正成熟的 `AbstractMechanism` 图层
- 面向 bridge reasoning 的稳定 query contract
- 更强的 structural analogy / isomorphism 检索能力
- 更完善的 field/domain/mechanism 元数据写入与回流

换言之：

- 当前已有“图驱动创新设计”的基础
- 但还没有达到“图谱本身已经足够支持强跨域机制迁移”的程度

## 6.2 IDEA-CATALYST 子流水线仍未完整实现 blueprint 的六代理控制环

目前虽已有：

- Decomposer
- Translator
- Scout
- Gatekeeper
- Integrator
- Judge

但还缺以下强版本能力：

- Decomposer：更严格的 per-question coverage 评估
- Translator：更强的抽象机制质量控制
- Scout：更结构化的 bridge-driven domain selection
- Gatekeeper：更强的 sufficiency/requisition policy
- Integrator：更结构化的 idea fragment synthesis
- Judge：真正稳定的 pairwise / interdisciplinary-potential judging

也就是说：

- “有了六个名字和模块”
- 不等于“已经完整实现论文中那套 metacognitive machinery”

## 6.3 Investigation requisition 闭环仍不够强

理想目标应是：

`Gatekeeper -> Investigation Requisition -> Ingestion -> Graph Build -> Frontier Refresh -> IDEA rerun`

当前状态：

- requisition 已经有状态与结构化输出
- workflow 也已经能理解它
- 但这条链还没有成为一个绝对稳定、彻底 workflow-owned 的全自动闭环

## 6.4 旧 `pn_idea_catalyst.py` 路径仍未收口

目前仍未完全决定：

- 是原地重构
- 还是保留并行新 bundle
- 还是彻底让它退役为 legacy path

这会影响后续：

- 文档清晰度
- skill 入口清晰度
- 维护负担

## 6.5 workflow-guard 模块化虽已大幅推进，但 facade 仍偏厚

当前的真实情况是：

- 已经不是“所有逻辑都塞在一个文件里”
- 但也还远没达到“非常薄的 barrel/facade”

因此：

- 模块化工程已明显推进
- 但仍可继续拆
- 特别是剩余的 facade glue、project-state I/O 组织、少量 prompt/state 汇总逻辑，仍有继续收口空间

## 6.6 多项目自治与连续调度仍不是系统最成熟的部分

当前系统更适合：

- 单项目深推进
- 同一项目内 durable 恢复
- 阶段间协调

而不是：

- 大规模多项目自动轮转
- 完全无人值守的 project portfolio scheduling

---

## 7. 当前系统最值得修改的方向

基于现有计划、审查与代码状态，建议优先级如下。

## P0：继续补 PaperNexus KG/schema

这是当前最关键的能力增量来源。

建议重点：

1. 确定 domain taxonomy 方案
2. 稳定 domain-distance contract
3. 强化 `AbstractMechanism` 层
4. 提供可被 Scout/Gatekeeper 稳定消费的 bridge query contract

原因：

- 没有这层图谱能力，IDEA-CATALYST 很难真正从 heuristic 走向 KG-native

## P1：继续把 IDEA-CATALYST 做成强子流水线，而不是半脚手架

建议重点：

1. 强化 Decomposer 的 per-question coverage classification
2. 强化 Scout 的 bridge-native 检索与跨域候选筛选
3. 强化 Gatekeeper 的 requisition policy
4. 接通更强的 `requisition -> ingestion -> graph rebuild -> rerun` 闭环
5. 强化 Judge 的 pairwise / Elo-style 评审

原因：

- 这会直接提升创新点生成的逻辑性、跨域性和可比较性

## P2：继续补 Evo 风格的高阶写作/评审结构化约束

建议重点：

1. 继续结构化 `advantage / limitation / failure-case`
2. 继续细化 claim-level severity gate
3. 继续增强 writer/reviewer 的 story-first 自动流

原因：

- 当前已经有基础，但还可以更接近 EvoScientist / EvoSkills 的“叙事骨架先行、证据链回压”的状态

## P3：继续做 runtime hardening 与多项目自治

建议重点：

1. 更强的 crash recovery
2. 更强的 recovery replay / session reattachment
3. `done -> switch_project` 的自动轮转闭环

原因：

- 这是重要方向，但相较于当前更值得优先投资的知识图谱与创新设计能力，优先级略低

---

## 8. 对当前系统的一句话定位

当前的 `openclaw-research` 已经不是“一个靠 prompt 驱动的科研机器人原型”，而是：

**一套以 durable workflow 为核心、以 graph-first research 为基础、以写作与评审合同为约束、并正在向 KG-native IDEA-CATALYST 演进的科研自动化系统。**

它现在最强的地方是：

- workflow 基础设施
- durable runtime
- 写作/评审控制平面
- graph-first research loop

它现在最值得继续投入的地方是：

- PaperNexus KG/schema
- IDEA-CATALYST 的真正跨域机制迁移能力
- 更完整的 metacognitive ideation loop

---

## 9. 结论

如果从“系统是否已经有用”来看，答案是：

- **已经有用，而且主链功能较强**

如果从“是否已经达到 blueprint 想要的最强研究智能水平”来看，答案是：

- **还没有，尤其在 KG-native ideation 与跨域机制推理上仍有明显提升空间**

如果从“下一步最该做什么”来看，答案很明确：

1. 继续补齐 PaperNexus 的 domain / mechanism / bridge KG primitive
2. 继续把 IDEA-CATALYST 从半实现推进到完整子流水线
3. 再在此基础上继续强化 writer/reviewer/story/review pressure 的高阶结构化约束

换句话说，系统的基础设施阶段已经基本站稳，接下来最值得做的是把“研究智能”本身继续做深。
