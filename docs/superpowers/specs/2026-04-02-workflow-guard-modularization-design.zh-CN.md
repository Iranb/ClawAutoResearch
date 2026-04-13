# workflow-guard 模块化拆分设计

> 记录日期：2026-04-02  
> 目标文件：`tools/workflow-guard.ts`

## 背景

当前 `tools/workflow-guard.ts` 已增长到约 18k 行，承担了过多职责：

- workflow 共享类型
- manifest / state 的 normalize / serialize
- 项目初始化与 PROJECTS_STATE 同步
- PaperNexus / graph / experiment / review / writing 相关 gate
- auto iterator 缺失信号判定
- dynamic task 生成
- ideation / story / review pressure materializer
- slash command / workflow tool 消费的状态摘要

这会带来几个直接问题：

- 读代码时很难建立稳定心智模型
- 小改动容易碰到无关逻辑
- 类型、helper、业务规则互相缠绕
- 想要拆分 stage 逻辑时，容易因为引用链太长而不敢动

## 已有拆分现状

当前仓库里已经出现了 3 组与拆分相关的目录：

- `tools/workflow-commands/`
- `tools/workflow-guard-stages/`
- `tools/workflow-guard-modules/`

其中：

- `tools/workflow-commands/`
  已经是可工作的拆分成果，适合作为后续 guard 模块化的风格参考。
- `tools/workflow-guard-stages/`
  当前已经承接了一部分 stage-specific missing signal 收集逻辑。
- `tools/workflow-guard-modules/`
  是 Claude Ops 早期拆分时留下的实验性目录；在当前实施阶段已经清理，不再作为正式结构保留。

本设计把这两个与 guard 相关的新目录视为：

- `workflow-guard-stages/`：可保留并继续扩展
- `workflow-guard-modules/`：已经完成清理，避免和正式结构混用

在当前实施轮次里，又新增了两组正式目录：

- `tools/workflow-guard-recorders/`
- `tools/workflow-guard-runtime/`

它们分别承接：

- `recordCitationVerification / recordIdleResearchRun / recordInnovationReflection / getExperimentMemorySummary / upsertExperimentLedgerEntry`
- `runWorkflowAutoIterator` 这类运行时主循环 glue

## 设计目标

1. 让 `workflow-guard.ts` 退化成稳定 facade，而不是承载全部业务实现。
2. 让“按阶段理解 workflow”成为默认阅读路径。
3. 让“按合同理解 workflow state”成为第二条阅读路径。
4. 保持当前对外 API 和测试语义稳定，不搞一次性重写。
5. 把大文件拆成“人能看懂、agent 能稳改”的模块粒度。

## 不做的事

- 不改变当前 workflow 的业务阶段定义
- 不改外部工具名和现有 slash command 契约
- 不一口气重写全部 normalize / serialize 逻辑
- 不引入新的状态文件体系

## 总体架构

推荐把 `workflow-guard` 分成 7 层：

1. facade 层
2. core/shared 层
3. state contract 层
4. stage gate 层
5. materializer / summary 层
6. recorder / runtime 层
7. task / guidance 层

### 1. facade 层

保留 `tools/workflow-guard.ts` 作为唯一公共入口，职责只有：

- 统一 export
- 组装依赖
- 维持向后兼容
- 充当迁移期间的胶水层

目标是把 facade 控制在约 1k-2k 行以内。

### 2. core/shared 层

建议新建目录：

- `tools/workflow-guard-core/`

建议文件：

- `types.ts`
- `coercion.ts`
- `paths.ts`
- `fs.ts`
- `strings.ts`
- `project-context.ts`

职责：

- `asRecord` / `pickString` / `pickBoolean` / `pickNumber`
- `normalizeStage` / `normalizeRole` / `normalizeGraphPresenceStatus`
- `resolveProjectArtifactPath` / `resolveTrackArtifactPath`
- `pathExists` / `readTextIfExists` / `readJsonIfExists`
- 通用字符串和路径 helper

原则：

- 只能有无业务或弱业务依赖的 helper
- 不能直接依赖具体 stage

### 3. state contract 层

建议新建目录：

- `tools/workflow-guard-state/`

按合同拆文件，而不是继续全部堆在一个文件里：

- `research-program.ts`
- `brainstorm-cycle.ts`
- `ideation-contract.ts`
- `paper-story.ts`
- `review-pressure.ts`
- `writing-contract.ts`
- `paper-ingestion.ts`
- `experiment-ledger.ts`
- `experiment-search.ts`
- `review-issue-tracker.ts`
- `paper-qc.ts`
- `figure-qc.ts`
- `citation-integrity.ts`
- `citation-collection.ts`
- `theory-support.ts`
- `graph-guided-writing.ts`
- `orchestration-state.ts`
- `gate-state.ts`

每个文件只负责：

- 类型
- normalize
- serialize
- validation helpers
- summary helpers

这样读某一类 contract 时，不需要滚过几千行 unrelated 代码。

### 4. stage gate 层

当前已有：

- `tools/workflow-guard-stages/`

建议把它正式化，作为 stage gate 主目录保留。

推荐结构：

- `foundation-stage-signals.ts`
  - `setup`
  - `graph_build`
  - `frontier_mapping`
- `ideation-stage-signals.ts`
  - `idea`
  - `plan`
  - `code`
- `execution-stage-signals.ts`
  - `experiment`
  - `analyze`
  - `review`
- `writing-stage-signals.ts`
  - `write`
  - `submit`
- `types.ts`

后续可以再加：

- `stage-routing.ts`
  - stage -> owner
  - stage -> next stage
  - stage -> default command
- `stage-microstates.ts`
  - graph_build/uploading/verifying/brainstorm_refresh
  - setup onboarding micro-states

### 5. materializer / summary 层

建议新建目录：

- `tools/workflow-guard-materializers/`
- `tools/workflow-guard-summaries/`

`materializers/` 推荐文件：

- `ideation-contract-materializer.ts`
- `paper-story-materializer.ts`
- `review-pressure-materializer.ts`
- `graph-storyline-materializer.ts`

`summaries/` 推荐文件：

- `gate-state-summary.ts`
- `research-program-summary.ts`
- `ideation-contract-summary.ts`
- `paper-story-summary.ts`
- `review-pressure-summary.ts`
- `paper-ingestion-summary.ts`
- `experiment-memory-summary.ts`

拆分原因：

- 这些函数往往 I/O 很多，业务链很长
- 它们是“生成 durable 文档/状态”的核心，但不属于 stage gate 本身
- 后面最容易继续增长

### 6. recorder / runtime 层

建议新建目录：

- `tools/workflow-guard-recorders/`
- `tools/workflow-guard-runtime/`

推荐文件：

- `state-recorders.ts`
- `auto-iterator.ts`

职责：

- `state-recorders.ts`
  - `recordCitationVerification`
  - `recordIdleResearchRun`
  - `recordInnovationReflection`
  - `getExperimentMemorySummary`
  - `upsertExperimentLedgerEntry`
- `auto-iterator.ts`
  - `runWorkflowAutoIterator`

这样可以把“高 I/O、强状态写入、但不属于 stage gate 本身”的大逻辑从 facade 中挪开。

### 7. task / guidance 层

建议新建目录：

- `tools/workflow-guard-guidance/`

推荐文件：

- `dynamic-tasks.ts`
- `handoff-guidance.ts`
- `papernexus-guidance.ts`
- `writing-guidance.ts`
- `review-guidance.ts`

这层承接当前 `buildDynamicTasks(...)` 及其大量 stage-specific prompt/task 规则。

## 推荐的最终目录结构

```text
tools/
  workflow-guard.ts
  workflow-guard-core/
    types.ts
    coercion.ts
    fs.ts
    paths.ts
    strings.ts
    project-context.ts
  workflow-guard-state/
    research-program.ts
    brainstorm-cycle.ts
    ideation-contract.ts
    paper-story.ts
    review-pressure.ts
    writing-contract.ts
    paper-ingestion.ts
    experiment-ledger.ts
    experiment-search.ts
    review-issue-tracker.ts
    paper-qc.ts
    figure-qc.ts
    citation-integrity.ts
    citation-collection.ts
    theory-support.ts
    graph-guided-writing.ts
    orchestration-state.ts
    gate-state.ts
  workflow-guard-stages/
    foundation-stage-signals.ts
    ideation-stage-signals.ts
    execution-stage-signals.ts
    writing-stage-signals.ts
    stage-routing.ts
    stage-microstates.ts
    types.ts
  workflow-guard-materializers/
    ideation-contract-materializer.ts
    paper-story-materializer.ts
    review-pressure-materializer.ts
  workflow-guard-summaries/
    ideation-contract-summary.ts
    paper-story-summary.ts
    review-pressure-summary.ts
    paper-ingestion-summary.ts
    ...
  workflow-guard-recorders/
    state-recorders.ts
  workflow-guard-runtime/
    auto-iterator.ts
  workflow-guard-guidance/
    dynamic-tasks.ts
    papernexus-guidance.ts
    writing-guidance.ts
    review-guidance.ts
```

## 拆分顺序

### Phase 1：巩固当前 stage 拆分

目标：

- 正式承认 `workflow-guard-stages/` 是第一层拆分成果
- 把 `getMissingStageSignals(...)` 的所有 stage case 全部从 facade 中搬走
- 保持测试全绿

验收标准：

- `workflow-guard.ts` 中不再有按 stage 展开的巨大 switch 实现细节
- `auto-iterator`、`workflow-commands`、`runtime-tools` 相关测试不回归

### Phase 2：抽 core helpers

目标：

- 把通用 helper 从 `workflow-guard.ts` 中抽到 `workflow-guard-core/`

优先迁移：

- `pickString`
- `pickNumber`
- `pickBoolean`
- `asRecord`
- `asString`
- `asStringArray`
- `pathExists`
- `readTextIfExists`
- `readJsonIfExists`
- `writeTextEnsured`
- `writeJsonEnsured`
- `resolveProjectArtifactPath`
- `resolveTrackArtifactPath`
- `normalizeStage`

验收标准：

- facade 中的 helper 数量显著下降
- 新模块没有形成循环依赖

### Phase 3：抽 state contract

目标：

- 把 normalize / serialize / validate 这三件事按合同归位

优先顺序：

1. `research-program`
2. `ideation-contract`
3. `paper-story`
4. `review-pressure`
5. `paper-ingestion`
6. `writing-contract`

原因：

- 这几类是目前最常碰、最影响理解的合同

### Phase 4：抽 materializer

目标：

- 把长链条的 durable artifact 生成逻辑搬到 `materializers/`

优先顺序：

1. `materializeIdeationContract`
2. `materializePaperStoryState`
3. `materializeReviewPressurePacket`

原因：

- 这些函数阅读成本高
- 它们天然是“独立子系统”
- 也是后续最适合继续增强的区域

### Phase 5：抽 recorder / runtime glue

目标：

- 把 state-heavy recorder 与 auto iterator 主循环从 facade 中迁出

原因：

- 这些逻辑读写状态很多，改动风险高
- 它们更像“运行时子系统”，不该夹在 facade 中间

### Phase 6：抽 dynamic task / guidance

目标：

- 把 `buildDynamicTasks(...)` 及其 stage-dependent guidance 抽离

原因：

- 这是另一个很容易继续失控的巨型函数
- 它更像 “policy + prompt guidance”，不应和 state contract 混在一起

## 命名与边界原则

1. 不按技术层拆成 `utils.ts` / `helpers.ts` 大杂烩。
2. 优先按 workflow 语义拆。
3. 每个文件只围绕一类 state 或一组 stage。
4. facade 只负责“连接”，不负责“实现全部细节”。
5. 新模块应尽量无副作用，I/O 集中到 materializer / summary / project-state 类模块。

## 兼容策略

为了减少风险，拆分过程保持以下策略：

- 对外继续从 `workflow-guard.ts` export
- 旧函数名不急着改
- 新模块先内部导入，稳定后再考虑直接对外暴露
- 新目录使用与现有仓库一致的 shim 风格，避免 node 直接跑测试时 ESM 解析出问题

## 风险

### 风险 1：循环依赖

原因：

- normalize / summary / materializer / stage gate 之间天然互相引用

缓解：

- `core` 只能被依赖，不能反向依赖业务模块
- `state` 不直接 import `stages`
- `stages` 只消费 `state` 和 `core`
- `materializers` 可消费 `state` 和 `core`，但不反向被 `state` 依赖

### 风险 2：测试夹具过时

原因：

- 拆出新 contract 字段后，旧测试 fixture 容易漏字段

缓解：

- 统一保留和更新 test seeding helper
- 优先用 seed helper，而不是在单测里手写巨大 manifest

### 风险 3：Node 直接跑源码的模块解析

原因：

- 当前测试链并不只走编译后的 `dist`

缓解：

- 继续保留无扩展 shim 文件模式
- 每新增一组子模块，都遵循与 `tools/workflow-trace` 一致的导出方式

## 阅读路线建议

拆完后，推荐的阅读顺序应该是：

1. `workflow-guard.ts`
2. `workflow-guard-stages/*`
3. `workflow-guard-state/` 中和当前问题最相关的 contract
4. `workflow-guard-materializers/*`
5. `workflow-guard-guidance/*`

这样新同学或 agent 不需要一上来面对 18k 行大文件。

## 最终目标

最终不追求“零大文件”，而追求：

- facade 可快速浏览
- stage 逻辑能按阶段阅读
- contract 逻辑能按状态阅读
- materializer 能按 durable artifact 阅读
- guidance 能按 agent 行为阅读

换句话说，目标不是把 18k 行机械切碎，而是把它变成几条**人能建立稳定心智模型**的阅读路径。
