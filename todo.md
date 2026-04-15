# TODO: 用 Workflow Hooks 把写作规范做成硬性约束

## 当前实施分解（基于新的 hook 实现）

- [x] Phase A-1: 新增 writing hook policy materializer，并把 writing norms 映射到现有 `file_audit` hook
- [x] Phase A-2: 在 `stage-preflight` 中自动刷新 writing hook policies
- [x] Phase A-3: 暴露 `research_workflow.materialize_writing_hook_policies`
- [x] Phase B-1: 给 hooks 增加 `filters / appliesWhen / workflow context / changedPaths`
- [x] Phase B-2: 让 `write_text_artifact` 和 hook executor 支持 change-driven rerun
- [x] Phase C-1: 把 `write` 阶段拆成稳定的 section-level task surface
- [x] Phase C-2: 基于 section packet / writing session 再做更细的 target resolution
- [x] Phase D: survey-specific writing hooks

## 当前实现的边界

- 已落地：
  - `paper-plan-thesis-audit`
  - `paper-plan-figure-anchor-audit`
  - `abstract-claim-audit`
  - `introduction-gap-story-audit`
  - `results-claim-evidence-audit`
  - `related-work-positioning-audit`
  - `conclusion-boundary-audit`
  - `main-tex-consistency-audit`
  - `figure-caption-audit`
- 已落地的 section task surface：
  - `write.section.abstract`
  - `write.section.introduction`
  - `write.section.related_work`
  - `write.section.method`
  - `write.section.results`
  - `write.section.discussion`
  - `write.section.conclusion`
  - `write.section.scope_and_protocol`
  - `write.section.taxonomy`
  - `write.section.evidence_synthesis`
  - `write.section.benchmark_landscape`
  - `write.section.open_problems`
- 仍保守处理：
  - hook target resolution 已优先读取 `writing_session.section_packets[*].draft_path/packet_path/review_path`，但 packet-path 作为 target 的语义仍然偏保守，默认仍优先 draft prose
  - survey hooks 目前主要覆盖 survey 专属 section 和 manuscript closeout，还没有进一步细分成更多 survey-only paragraph / sub-section 审核层
  - `stateScope` 已进入合同，但还没有扩成更复杂的 shared-state 调度策略

目标：
把当前已经存在于 `paper-plan` / `paper-write` / `research-paper-writing` 里的写作规范，
从“prompt / skill 层的软要求”，升级为 `openclaw-research` workflow 中的 **durable、可审计、可阻塞** 约束。

这份 TODO 聚焦：

- 英文论文写作质量
- claim / evidence 对齐
- abstract / introduction / results / conclusion 的 headline safety
- paragraph logic / reverse outline / figure caption / related work positioning
- 如何基于当前已落地的 `workflow hooks` 实现

这份 TODO 不替代 `todo.plan`。
`todo.plan` 继续聚焦 top-tier evidence 架构；
本文件聚焦 **writing norms as workflow gates**。

---

## 0. 参考基线

### 外部基线

- Vite Plugin API: [https://vite.dev/guide/api-plugin](https://vite.dev/guide/api-plugin)
- Vite Environment API for Plugins: [https://vite.dev/guide/api-environment-plugins](https://vite.dev/guide/api-environment-plugins)

这次借鉴 Vite，不是为了“模仿它的前端插件接口”，而是借鉴它的 hooks 设计原则：

1. **先过滤再执行**
   - 类似 Vite 的 hook filter
2. **hook 必须带上下文**
   - 类似 `this.environment`
3. **插件 / hook 的适用范围要显式声明**
   - 类似 `applyToEnvironment`
4. **状态共享与隔离要有策略**
   - 类似 `sharedDuringBuild`
5. **变更驱动，而不是每次全量重跑**
   - 类似 `hotUpdate`

### 当前仓库内的现成资产

写作规范已经大量存在于这些地方：

- `skills/academic_writer/paper-plan/SKILL.md`
- `skills/academic_writer/paper-write/SKILL.md`
- `skills/academic_writer/research-paper-writing/SKILL.md`
- `tools/research-writing/materializers.ts`
- `tools/workflow-guard-writing/write-package-eval.ts`

当前 hooks 基础设施已经存在于：

- `tools/workflow-hooks/contracts.ts`
- `tools/workflow-hooks/executor.ts`
- `tools/workflow-hooks/file-audit-runner.ts`
- `tools/workflow-hooks/state.ts`
- `tools/workflow-hooks/gateways.ts`
- `tools/register-workflow-hooks.ts`

当前 hooks 入口已经接在：

- `artifact_materialized`
- `before_stage_handoff`
- `before_task_complete`
- `before_handoff_activation`
- `after_handoff_activation`

当前 workflow 写作入口已经接在：

- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-team/task-hooks.ts`

---

## 1. 当前系统已经具备什么

### 1.1 已有“软规范”

当前系统已经明确要求这些写作规范：

- thesis crystallization
- contribution delta
- claim-evidence alignment
- unsupported claim downgrade
- reverse outline
- paragraph role clarity
- figure-centric writing
- prewrite rejection simulation
- skepticism / novelty attack / limitation audit
- survey mode 下的 comparative writing

这些规范已经在下面文件里明确写出：

- `paper-plan/SKILL.md`
- `paper-write/SKILL.md`
- `research-paper-writing/SKILL.md`

### 1.2 已有“durable scaffold”

系统已经能自动 materialize 一批对写作很重要的工件：

- `PAPER_PLAN.md`
- `STORYLINE_SKETCH.md`
- `STORY_SPINE.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`
- `FIGURE_ANCHOR_PLAN.md`
- `PREWRITE_REJECTION_SIMULATION.md`
- `WRITING_REFERENCE_BUNDLE.json`
- `SURVEY_SECTION_BRIEFS.md`
- `SURVEY_SELF_REVIEW.md`

### 1.3 已有“process-first”写作状态机

`evaluateWritingProcessReadiness(...)` 已经支持：

- `missing`
- `bootstrapping`
- `outline_ready`
- `drafting`
- `section_review`
- `manuscript_complete`
- `compile_ready`
- `ready_for_submit`

这已经是很好的基础。

---

## 2. 当前最大问题

最大问题不是“没有写作规范”，而是：

`这些规范还没有成为 workflow 的硬约束。`

现在的情况更像：

- skill / prompt 会提醒 writer
- state / artifacts 会帮助 writer
- reviewer 可能会在后面抓问题

但系统还没有稳定做到：

- 某个 section 如果 claim 越界，task 无法完成
- 某个 abstract 如果 headline claim 和 evidence 不一致，handoff 无法放行
- 某个 introduction 如果 gap / contribution / evidence 不对齐，进入 submit 前一定被拦下

换句话说：

- **规范存在**
- **工件存在**
- **hooks 存在**
- 但三者还没有被系统性接起来

---

## 3. 核心设计原则

### 原则 1：先复用当前 `file_audit` hook

当前稳定 hook type 只有：

- `file_audit`

因此第一阶段不要新增 hook type。
先用 `file_audit` 把写作规范真正接起来。

### 原则 2：materializer 负责生成，hooks 负责审核

不要让 hook 自己去生成：

- section briefs
- writing workbench
- claim map
- revision state

这些仍应由：

- `materializeWritingSupportArtifacts`
- 新增的 writing-side materializer

先生成，再由 hook 审核。

### 原则 3：先抓“高价值硬约束”

第一阶段不要试图把所有风格建议都硬化。
先抓最值得变成硬门的几类问题：

1. unsupported headline claims
2. abstract / intro / results / conclusion 与 claim-evidence 不一致
3. related work 失去 positioning、变成 catalog
4. paragraph logic 崩坏，导致 section 不可读
5. limitation / boundary 缺失，结论越界

### 原则 4：按 hook point 分层

- `artifact_materialized`
  - 更适合 scaffold 审查
- `before_task_complete`
  - 更适合 section-level 审查
- `before_stage_handoff`
  - 更适合整阶段 closeout 审查
- `before_handoff_activation`
  - 更适合最终兜底 gate

### 原则 5：借鉴 Vite，先做 filter / context，再铺大规模 hooks

如果不先做 filter/context：

- 所有 `before_task_complete` hook 会在每次 task 完成时粗粒度运行
- 成本高
- 误触发多
- 难以扩展

所以真正的实现顺序应该是：

1. 先把 hook filter / context 做好
2. 再铺 writing hooks

---

## 4. 第一期：用当前 hook 体系接入“最小可行写作硬约束”

## 4.1 新增 writing hook policy materializer

新增文件：

- `tools/research-writing/hook-policies.ts`

新增核心函数：

```ts
materializeWritingHookPolicies(params: {
  projectRoot: string
  stage: string | null
  paperMode: "conference" | "journal" | "survey" | null
  topTierVerdict: string | null
})
```

职责：

- 读取当前项目的 writing contract / paper story / review pressure / paper mode
- 自动生成适合当前阶段的 `workflow_hooks.audit_hooks`
- 通过现有 `setFileAuditPolicyForProject(...)` 写入 `PROJECT_MANIFEST.json.workflow_hooks`

不要做的事：

- 不直接运行 audit
- 不直接 dispatch reviewer
- 不直接 materialize prose files

### 第一阶段建议生成的 hook policies

#### A. `plan` / `review -> write` 之前

1. `paper-plan-thesis-audit`
   - target: `academic_writer/PAPER_PLAN.md`
   - point: `before_stage_handoff`
   - stage: `review`
   - blocking: `block_stage`
   - 检查：
     - thesis 是否单一
     - contribution list 是否具体
     - headline claims 是否都可映射到 `CLAIM_EVIDENCE_MATRIX.md`

2. `paper-plan-figure-anchor-audit`
   - target: `academic_writer/FIGURE_ANCHOR_PLAN.md`
   - point: `artifact_materialized`
   - stage: `write`
   - blocking: `warn_only`
   - 检查：
     - Figure 1 是否承担主叙事入口
     - figures 是否真的支撑 claims

#### B. `write` 阶段 section-level

3. `abstract-claim-audit`
   - target: `academic_writer/paper/sections/abstract.tex`
   - point: `before_task_complete`
   - stage: `write`
   - blocking: `block_stage`
   - 检查：
     - abstract 是否包含 problem / gap / action / result / implication
     - headline claim 是否越过 evidence

4. `introduction-gap-story-audit`
   - target: `academic_writer/paper/sections/introduction.tex`
   - point: `before_task_complete`
   - stage: `write`
   - blocking: `revise`
   - 检查：
     - gap 是否明确
     - contribution list 是否和 results 对齐
     - 引言是否真的在讲 problem-gap-method-evidence

5. `results-claim-evidence-audit`
   - target: `academic_writer/paper/sections/results.tex`
   - point: `before_task_complete`
   - stage: `write`
   - blocking: `block_stage`
   - 检查：
     - 每个 headline result 是否可回指 evidence
     - unsupported claim 是否重新混入 prose

6. `related-work-positioning-audit`
   - target: `academic_writer/paper/sections/related_work.tex`
   - point: `before_task_complete`
   - stage: `write`
   - blocking: `revise`
   - 检查：
     - related work 是否在做 positioning
     - 是否只是 paper-by-paper catalog

7. `conclusion-boundary-audit`
   - target: `academic_writer/paper/sections/conclusion.tex`
   - point: `before_task_complete`
   - stage: `write`
   - blocking: `revise`
   - 检查：
     - 结论是否越界
     - limitation / boundary 是否存在

#### C. `write -> submit`

8. `main-tex-consistency-audit`
   - target: `academic_writer/paper/main.tex`
   - point: `before_handoff_activation`
   - stage: `write`
   - blocking: `block_stage`
   - 检查：
     - abstract / intro / results / conclusion 是否互相一致
     - contribution wording 是否与 evidence ledger 一致

9. `figure-caption-audit`
   - target: `academic_writer/paper/main.tex`
   - point: `before_handoff_activation`
   - stage: `write`
   - blocking: `revise`
   - 检查：
     - captions 是否自解释
     - figure/table narrative 是否支撑 main claim

## 4.2 在 stage-preflight 中自动 materialize 写作 hook policies

修改文件：

- `tools/workflow-guard-runtime/stage-preflight.ts`

接入位置：

- 在 `materializeWritingSupportArtifacts(...)` 之后
- 只在这些阶段运行：
  - `plan`
  - `write`
  - `review`
  - `submit`

建议新增逻辑：

```ts
await materializeWritingSupportArtifacts(...)
await materializeWritingHookPolicies(...)
```

目标：

- 让写作 hook policy 成为 workflow-owned scaffold 的一部分
- 而不是依赖用户手动 `set_file_audit_policy`

## 4.3 暴露 workflow tool action

修改文件：

- `tools/register-workflow-tools.ts`

新增 action：

- `materialize_writing_hook_policies`

目的：

- 允许人工触发
- 允许 auto-iterator / runtime 显式调用
- 让调试更直接

## 4.4 最小版本先不新造 hook type

第一阶段明确不做：

- `section_quality_audit`
- `claim_graph_audit`
- `paragraph_audit`

统一先落到：

- `file_audit`

因为现有 runner / state / revision dispatch 都已经支持。

---

## 5. 第二期：借鉴 Vite，把 hook 体系升级成“适合大规模写作约束”的形态

## 5.1 增加 Hook Filters

修改文件：

- `tools/workflow-hooks/contracts.ts`
- `tools/workflow-hooks/state.ts`
- `tools/workflow-hooks/executor.ts`

新增字段建议：

```ts
filters?: {
  workflowLines?: string[]
  paperModes?: string[]
  targetRoles?: string[]
  taskIds?: string[]
  taskPrefixes?: string[]
  fileGlobs?: string[]
  materializedContracts?: string[]
  changedPathsAny?: string[]
}
```

借鉴自 Vite：

- 先 filter
- 再真正进入 handler
- 即使 filter 命中，runner 内部仍做最后一次检查

收益：

- 不会所有 `before_task_complete` hook 在每个 task 上都跑一遍
- 写作 hook 可以精确挂到：
  - abstract task
  - intro task
  - results task

## 5.2 增加 `WorkflowHookContext`

修改文件：

- `tools/workflow-hooks/contracts.ts`
- `tools/workflow-hooks/state.ts`
- `tools/workflow-hooks/gateways.ts`
- `tools/workflow-hooks/executor.ts`

建议新增上下文字段：

```ts
workflowLine: "experiment" | "survey" | "unknown"
paperMode: "conference" | "journal" | "survey" | null
targetStage: string | null
transition: string | null
artifactKinds: string[]
changedPaths: string[]
```

借鉴自 Vite `this.environment`：

- hook 不应再靠调用方零散拼接信息
- hook 自己要能知道“我现在在哪个 workflow environment 中运行”

## 5.3 增加 `applyToContext`

修改文件：

- `tools/workflow-hooks/contracts.ts`
- `tools/workflow-hooks/executor.ts`
- `docs/architecture/workflow-hooks.md`

建议新增：

```ts
appliesWhen?: {
  workflowLines?: string[]
  paperModes?: string[]
  stages?: string[]
}
```

这就是 workflow 里的 `applyToEnvironment`。

收益：

- survey hooks 和 experiment hooks 不会互相误伤
- top-tier strict hooks 可以只作用于：
  - `worth_top_tier_bet`
  - `paper_mode = conference/journal`

## 5.4 增加 shared vs isolated hook state

修改文件：

- `tools/workflow-hooks/contracts.ts`
- `tools/workflow-hooks/state.ts`
- `tools/workflow-hooks/executor.ts`

建议新增：

```ts
stateScope?: "isolated" | "shared_by_stage" | "shared_by_transition"
```

借鉴自 `sharedDuringBuild`：

- 有些 hook 状态必须隔离
- 有些 aggregate / cache 可以按 stage 或 transition 共享

## 5.5 增加 change-driven rerun

修改文件：

- `tools/workflow-hooks/executor.ts`
- `tools/workflow-hooks/state.ts`
- `tools/workflow-artifact-text-writer.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`

建议：

- `write_text_artifact` 记录本次 changed path
- `artifact_materialized` / `before_task_complete` 传递 `changedPaths`
- executor 只重跑受影响的 hooks

借鉴自 Vite `hotUpdate`：

- 不是每次都 full reload
- 尽量只处理受影响模块 / artifacts

---

## 6. 第三期：把写作任务粒度做细，让 hooks 真正能卡 section

当前问题：

- `tools/workflow-team/stage-profiles.ts` 在 `write` 阶段的任务太粗
- 当前更像：
  - `write.polish_and_compile`
  - `write.keep_story_and_evidence_aligned`

这不够支撑 section-level hard constraints。

### 改造目标

把 `write` 阶段任务拆到 section 或 section-group：

- `write.section.abstract`
- `write.section.introduction`
- `write.section.related_work`
- `write.section.method`
- `write.section.results`
- `write.section.discussion`
- `write.section.conclusion`

修改文件：

- `tools/workflow-team/stage-profiles.ts`
- `tools/workflow-team/task-graph.ts`

收益：

- `before_task_complete` hooks 才能真正精确命中
- abstract / intro / results 的 writing rules 才能成为 task-level gates

---

## 7. 具体代码实现顺序

### Phase A: 最小可行版本

1. 新建 `tools/research-writing/hook-policies.ts`
2. 实现 `materializeWritingHookPolicies(...)`
3. 在 `stage-preflight.ts` 接入 `materializeWritingHookPolicies(...)`
4. 在 `register-workflow-tools.ts` 注册 `materialize_writing_hook_policies`
5. 先生成 3 个最关键 hooks：
   - `abstract-claim-audit`
   - `results-claim-evidence-audit`
   - `main-tex-consistency-audit`

### Phase B: Vite-inspired hooks upgrade

6. 给 `WorkflowFileAuditHookPolicy` 增加 `filters`
7. 给 `WorkflowHookPointContext` 增加 `workflowLine / paperMode / changedPaths`
8. 在 executor 中应用 filter matching
9. 在 docs 中补充 `applyToContext` 说明

### Phase C: section-level enforcement

10. 将 `write` 阶段拆成 section tasks
11. 把 intro / related work / conclusion hooks 接到 `before_task_complete`
12. 在 `write_text_artifact` / recovery path 中增加 changed-path-aware rerun

---

## 8. 测试计划

新增测试：

- `tests/workflow-writing-hooks-policy.test.mjs`
  - 验证 writing hook policy materializer 生成正确 policy

- `tests/workflow-writing-hooks-executor.test.mjs`
  - 验证 abstract / results / main.tex hooks 在正确 hook point 上运行

- `tests/workflow-writing-hooks-filters.test.mjs`
  - 验证 filters 命中与跳过逻辑

- `tests/workflow-writing-hooks-rerun.test.mjs`
  - 验证 changed path 只重跑受影响 hooks

扩展测试：

- `tests/workflow-hooks-executor.test.mjs`
- `tests/workflow-hooks-state.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`
- `tests/workflow-team-runtime.test.mjs`

重点验证：

1. unsupported abstract claim 会 block
2. weak related work 只会 revise，不会直接 block
3. main.tex inconsistency 会阻止 `write -> submit`
4. survey hooks 不会误打 experiment 项目
5. 普通项目不会被 top-tier strict hooks 误伤

---

## 9. 完成定义

完成这份计划后，系统应达到：

- 写作规范不再只存在于 skill prompt，而是存在于 workflow hook policy
- abstract / intro / results / conclusion 的关键规范可以真正阻塞错误 handoff
- writer 的 section-level任务可以被 hooks 精准约束
- hooks 不再粗粒度全量重跑，而是有 filter / context / changed-path rerun
- survey / experiment / top-tier / 普通项目能共享一套 hooks 体系，但严格度不同

最终效果：

`更好的写作` 不再只是“writer 尽量写好”，而是 workflow 会在关键节点上强制保护论文质量。
