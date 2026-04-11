# Workflow Pipeline 重构与 Agent Teams Runtime 实施计划

> **Status:** DRAFT

> **For agentic workers:** 这份计划不是“继续往现有系统上加层”的指令，而是“先收束 pipeline 内核，再把 Agent Teams 风格推进机制落到新内核上”的重构路线。任何实现都必须先补回归，再做最小可逆变更，并优先删除重复表达而不是继续堆逻辑。

**Goal:** 基于当前 `openclaw-research` 的真实代码结构，重构 workflow pipeline，把当前分散在 `workflow-guard`、`register-workflow-tools`、`register-workflow-service`、`workflow-fast-paths`、`workflow-handoff-runtime`、`snapshot-builder` 等处的决策、执行、协作、投影逻辑收束成统一内核；在这个基础上，把当前仍缺失的 top-tier evidence moat 机制变成 first-class workflow contracts，最后再把 stage 内推进升级成 Claude Agent Teams 风格的共享 task graph、claim/lease、completion gate 与 idle continuation。

**Architecture:** 不替换现有 stage truth，不推翻 durable workflow facts。保留 `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`GATE_STATE.json`、`EXPERIMENT_LEDGER.json` 与 `auto_iterator_tick` 作为阶段真相源；重点重构“谁决定下一步”“谁执行派发”“谁维护协作状态”“谁生成 snapshot / dashboard 读模型”这几层的边界。与此同时，把 benchmark protocol lock、statistical evidence、venue competition、ablation/mechanism evidence、reproducibility pack、camera-ready evidence pack、top-tier bet gating 做成 workflow-owned contracts，而不是散落在 skill、prompt、review 备注中的软约束。Team Runtime 不直接建立在今天分散的 service/fast-path/mailbox 实现之上，而是建立在统一的 Workflow Kernel 与 Evidence Kernel 之上。

**Tech Stack:** TypeScript、Node.js built-in test runner、现有 workflow runtime state 文件、dashboard 读模型、OpenClaw plugin/tool/service/hook 入口。

**Progress Snapshot (2026-04-11):**

- 已完成切片 A：引入 `tools/workflow-kernel/graph-context.ts`，把 `auto_iterator` 的 graph-sensitive refresh / routing / repair 判断统一到 graph context adapter；新增 `tests/workflow-kernel-refactor.test.mjs`，并通过 `tests/auto-iterator.test.mjs` 全量回归。
- 已完成切片 B：引入 `tools/workflow-evidence/papernexus-bridge.ts`，把 stage-preflight 对 workflow-owned PaperNexus packet/bundle 的存在性判断收束到统一 bridge；新增 `tests/workflow-evidence-kernel.test.mjs`。
- 当前实现分支：`codex/workflow-kernel-graph-context`
- 下一切片目标：把 graph-context / papernexus-bridge 接到更多 projection 和 evidence contracts，而不是继续在调用侧散落硬编码。

---

## 1. 为什么上一个版本还不够

上一个版本的核心假设是：

- 保留当前 pipeline
- 在当前 pipeline 下增加一层 Team Runtime

这个方向本身没有错，但它低估了当前代码面的一个更根本问题：

- **当前系统的复杂度不只是“少了 task graph”，而是 pipeline 内核本身已经分散且重复。**

如果不先收束 pipeline 内核，而是直接把 Team Runtime 加进去，结果大概率会是：

- stage truth 仍在一套逻辑里
- dispatch / background / pool / mailbox 又在另一套逻辑里
- task graph 再来第三套逻辑
- dashboard 再单独读第四套状态

这会让系统比现在更难维护。

所以这次 plan 的主张是：

1. 先重构 pipeline 内核
2. 再在新内核上落 Agent Teams 式 stage runtime

---

## 2. 基于当前代码库的诊断结论

下面的判断不是抽象建议，而是基于当前 workflow 相关代码面的具体分析。

### 2.1 当前 workflow 的真实形态

从 [docs/architecture/workflow-control-plane.md](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/docs/architecture/workflow-control-plane.md:7>) 可以确认：

- 系统当前明确是“durable state + workflow code 决定下一步”
- `auto_iterator_tick` 是最核心的执行入口
- 当前 handoff 是 `drive_stage` 级别，不是 task graph 级别

从 [tools/workflow-guard-runtime/auto-iterator.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-runtime/auto-iterator.ts:91>) 可以确认：

- dispatchable action 的选择仍然是从 `recommendedActions` 中选一个 `drive_stage`
- 当前系统能表达的主线动作还是：
  - `wait_human`
  - `drive_stage`
  - `background`

这说明当前 pipeline 的最小推进单元仍然是 stage action，而不是共享 task。

### 2.2 代码面上的核心问题不是“缺一个 task board”，而是“内核职责混杂”

关键文件体量：

- `tools/workflow-guard.ts`: **9384** 行
- `tools/register-workflow-tools.ts`: **2906** 行
- `tools/register-workflow-service.ts`: **4320** 行
- `tools/workflow-fast-paths.ts`: **3312** 行
- `tools/workflow-guard-project/snapshot-builder.ts`: **1651** 行
- `tools/register-workflow-hooks.ts`: **897** 行

这些数字本身不等于设计错误，但在当前仓库里，它们确实对应了明显的职责叠加。

### 2.3 已经可以确认的重复表达

#### A. `workflow-guard.ts` 与 `snapshot-builder.ts` 存在重复域逻辑

同名或同职责 helper 已经在两个地方重复出现，例如：

- `formatWorkflowShellArgument`
- `getResearchProgramOnboardingGaps`
- `getResearchProgramOnboardingStatus`
- `getResearchProgramPlanValidationErrors`
- `isInnovationReflectionDue`
- `getBrainstormCycleValidationErrors`

可见：

- [workflow-guard.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard.ts:2893>)
- [snapshot-builder.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-project/snapshot-builder.ts:156>)

这意味着当前“workflow fact / validation / projection”并没有共享同一个真正的 domain kernel。

#### B. execution/runtime 数据结构在多个文件重复建模

`WorkflowRuntimeQueueDispatchPayload` 与 `WorkflowRuntimeQueueEntry` 已经在 [workflow-runtime-state.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-runtime-state.ts:76>) 定义，但 `workflow-fast-paths.ts` 里又有一套 `BackgroundWorkflowQueueDispatchPayload` / `BackgroundWorkflowQueueEntry`。

而 `acquireBackgroundWorkflowSession`、`recordBackgroundWorkflowRun` 等能力又在：

- [workflow-background-pool.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-background-pool.ts:809>)
- [workflow-fast-paths.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-fast-paths.ts:1566>)
- [register-workflow-service.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/register-workflow-service.ts:2039>)

之间反复穿透。

这说明当前 execution kernel 是分裂的。

#### C. mailbox / handoff / dispatch 链路被拆散在多个文件

当前 handoff 相关逻辑分散在：

- `tools/workflow-guard-collaboration.ts`
- `tools/workflow-handoff-runtime.ts`
- `tools/agent-task-dispatch.ts`
- `tools/lobster-handoff.ts`
- `tools/register-workflow-hooks.ts`
- `tools/register-workflow-service.ts`

其中：

- mailbox enqueue/ack 在 collaboration/runtime 两边都有参与
- dispatch 既可 native，又可 lobster，又和 mailbox ack 绑定
- hook 层还会自动 ack handoff mailbox

这条链已经具备能力，但边界并不清晰。

#### D. stage 定义分散，导致“阶段是什么”不是一个单一对象

今天一个 stage 的语义散在：

- `ROLE_POLICIES` / `STAGE_REQUIREMENTS`
- `auto_iterator`
- `stage-preflight`
- `stage-specific signals`
- `dynamic tasks`
- service 的 auto launch 策略
- dashboard 的 summary projection

也就是说，当前系统缺一个真正的 `StageDefinition`/`StageRuntimeDefinition`。

### 2.4 当前设计里真正应该保留的部分

这些不是问题，反而是这次重构必须保留的骨架：

- `PROJECT_MANIFEST.json` 仍然是 stage / owner / next_action / blocking_reason 的真相源
- `auto_iterator_tick` 仍然是阶段推进与回退的判定器
- runtime queue / sessions / announce / broadcast 已经 durable 化
- mailbox 作为 structured handoff / blocker / request / note 是合理的
- dashboard 是读模型，不应变成写控制面

### 2.5 从 `top-tier-paper-gap-analysis.md` 反推出来的结构性缺口

[docs/reference/top-tier-paper-gap-analysis.md](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/docs/reference/top-tier-paper-gap-analysis.md>) 提醒了一点：即使我们把 kernel 收束了、把 Team Runtime 做出来了，系统仍然未必能稳定产出 top-tier 论文。因为现在缺的不只是“更好的 handoff”，而是若干 **workflow-owned evidence contracts**。

结合当前代码面，可以看到这些缺口已经有一些零散前置能力，但还不是一等公民：

- **Benchmark registry / protocol lock**
  - 现在 `research_program` 已经有 baseline / dataset / metric 字段，[templates/PROJECT_MANIFEST.json](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/templates/PROJECT_MANIFEST.json:135>)。
  - survey 线也已经有 benchmark alignment 字段，[survey-review.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-state/survey-review.ts:183>)。
  - 但没有 benchmark object model、protocol lock file、protocol drift detection。

- **Statistical evidence**
  - 现在 analyze/review 技能会谈 significance，review rubric 也有 `significance` 字段，[authoring-review-state.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-state/authoring-review-state.ts:452>)。
  - 但没有 workflow-owned statistical aggregation materializer，也没有把多 seed 结果稳定升级成 claim-strength gate。

- **Venue-competitive novelty / competitor slate**
  - 现在有 novelty tree、novelty attack、venue routing、review pressure。
  - 但没有 target-venue competitor slate、acceptance-risk scorecard、venue-specific novelty kill-switch。

- **Ablation sufficiency / mechanism evidence**
  - `research_program` 已有 `required_ablations`，[research-program.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-state/research-program.ts:307>)。
  - execution state 也已有 `ablationSummaryPath`，[execution-state.ts](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-state/execution-state.ts:461>)。
  - 但没有“ablation sufficiency evaluator”，也没有从 ablation -> causal mechanism 的 workflow contract。

- **Release-grade reproducibility**
  - 现在有 remote run metadata、experiment ledger、git-aware candidate/incumbent control。
  - 但没有 reproducibility pack / supplementary bundle contract / reproduce-on-commit 验证。

- **Camera-ready evidence presentation**
  - 现在已有 `write_package`、`paper_qc`、`figure_qc`，[templates/PROJECT_MANIFEST.json](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/templates/PROJECT_MANIFEST.json:373>) [templates/PROJECT_MANIFEST.json](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/templates/PROJECT_MANIFEST.json:455>) [templates/PROJECT_MANIFEST.json](</Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/templates/PROJECT_MANIFEST.json:470>)。
  - 但没有从 results -> stats tables -> figures -> captions -> camera-ready section packets 的一体化 materializer。

- **Top-tier bet / opportunity model**
  - 现在 graph-backed ideation 已经很强，也有 venue fit hints。
  - 但没有明确的 “not worth a top-tier bet” kill gate，也没有 target-venue opportunity model。

### 2.6 更新后的总体判断

**结论：**

- 只做 additive Team Runtime：**不够合理**
- 先重构 pipeline kernel，再落 Team Runtime：**合理**
- 只做 kernel 重构，不把 top-tier evidence loops 变成 first-class contracts：**仍然不够**
- 重写整个 workflow fact model：**不合理**

---

## 3. 新的设计裁决

### 3.1 不再把“Team Runtime”当作唯一目标

新的主目标分成三层：

1. **Workflow Pipeline Kernel Refactor**
2. **Top-Tier Evidence Contracts**
3. **Agent Teams Style Stage Runtime**

第一层解决：

- 决策逻辑重复
- 执行逻辑重复
- 协作逻辑重复
- 投影逻辑重复

第二层解决：

- benchmark protocol lock
- statistical evidence
- venue-competitive positioning
- ablation sufficiency
- mechanism evidence
- reproducibility pack
- camera-ready evidence pack
- top-tier bet gating

第三层才解决：

- task graph
- claim / lease
- completion gate
- idle continuation

### 3.2 目标架构

重构后的 pipeline 应该收束成 6 个内核层：

#### Layer A: Workflow Fact Kernel

职责：

- stage registry
- stage owner / next stage
- readiness
- rollback / regression
- closeout eligibility

它是今天 `workflow-guard.ts + stage-preflight + stage signals + derived-state` 的统一内核。

#### Layer B: Workflow Collaboration Kernel

职责：

- mailbox
- contact cooldown
- handoff policy
- blocker/request/note lifecycle

它是今天 `workflow-guard-collaboration.ts + workflow-handoff-runtime.ts + handoff rules` 的统一内核。

#### Layer C: Workflow Execution Kernel

职责：

- runtime queue / session / announce / broadcast
- dispatch plan
- background pool
- pooled session lease
- native/lobster delivery adapter

它是今天 `workflow-runtime-state.ts + workflow-session-orchestrator.ts + workflow-fast-paths.ts + workflow-background-pool.ts + lobster-handoff.ts + agent-task-dispatch.ts` 的统一内核。

#### Layer D: Workflow Projection Kernel

职责：

- snapshot builder
- status formatter
- dashboard read models
- runtime health projection

它是今天 `snapshot-builder.ts + workflow-commands/formatters.ts + dashboard read-models` 的统一内核。

#### Layer E: Workflow Evidence Kernel

职责：

- benchmark registry / protocol lock
- statistical aggregation / significance artifacts
- venue competitor slate / novelty scorecard
- ablation sufficiency evaluator
- mechanism evidence packet
- reproducibility pack
- camera-ready evidence pack
- top-tier bet / opportunity model

这一层的目标不是替代 `research_program`、`experiment_review_state`、`paper_story_state`、`paper_qc`、`figure_qc`，而是给它们提供更强、更可验证的 evidence contracts。

#### Layer F: Workflow Team Runtime

职责：

- stage-scoped task graph
- claim / lease
- task completion verification
- teammate idle continuation

这一层建立在 A/B/C 上，不直接旁路它们。

### 3.3 PaperNexus 依赖分层

这次重构必须把 `PaperNexus` 的作用写清楚，否则很容易出现两种坏结果：

- 该依赖图谱的时候没依赖，最后把 novelty / venue competition / mechanism positioning 做成“无图猜测”
- 不该依赖图谱的时候过度依赖，导致本地实验、统计、复现、camera-ready 流程被外部图谱耦死

这份 plan 对 PaperNexus 的裁决是：

#### A. **必须依赖 PaperNexus 的地方**

- `graph_build`
- `frontier_mapping`
- `idea`
- top-tier path 下的 `venue_competition`
- top-tier path 下的 `opportunity_scorecard`
- graph-grounded `competitor slate`
- graph-grounded `mechanism prior` / cross-domain mechanism sourcing

这些地方如果没有 PaperNexus 或等价 graph context，就不应声称：

- novelty 已充分 grounding
- competitor slate 已充分建立
- venue-competitive positioning 已充分完成
- top-tier bet 已被认真评估

#### B. **建议用 PaperNexus 辅助，但本地证据仍是主事实源的地方**

- `benchmark_protocol`
  - 用于发现 benchmark family、常见 protocol variants、nearest comparison setup
  - 但最终 protocol lock 必须落在项目本地 contract 中
- `mechanism_evidence`
  - 用于发现先验机制、相近解释、相关 failure mode
  - 但真正的 mechanism evidence 仍必须由本地 ablation / intervention / analyzer packet 支撑
- `ablation_evidence`
  - 用于生成 reviewer-objection -> required ablation set 的候选映射
  - 但 sufficiency 最终要看本地实验结果
- `review_pressure_packet`
  - 可吸收 graph-backed novelty attack / competitor objection / venue expectations
  - 但最终 review verdict 仍由本地 evidence packet 决定
- `paper_story_state`
  - 可吸收 graph-backed related-work / gap / claim support context
  - 但正文 claim 不能只靠 graph 先验，仍要落到本地实验与分析

#### C. **不应该依赖 PaperNexus 的地方**

- `statistical_evidence`
- `reproducibility_pack`
- `camera_ready_evidence`
- execution kernel 的 queue/session/dispatch
- team runtime 的 claim/lease/idle continuation
- compile / figure placement / caption formatting / supplementary bundle assembly

这些环节应该以项目本地 artifacts 为唯一权威来源。PaperNexus 可以提供背景，但不能变成真相源。

#### D. **降级策略必须明确**

如果 PaperNexus 不可用，系统应做的是：

- 对 graph-sensitive 阶段：明确阻塞或降级，不伪装成 graph-grounded
- 对 evidence contracts：
  - `venue_competition`
  - `opportunity_scorecard`
  - graph-backed `mechanism_evidence`
  
  标记为 `unverified_graph_context` / `graph_unavailable`
- 对本地实验、统计、复现、camera-ready 流程：继续允许执行
- 对最终 top-tier bet 结论：禁止给出“已通过高标准新颖性/竞争性评估”的正向结论

---

## 4. 明确哪些东西不该重构

### 4.1 不重构 stage truth

不要把下面这些迁走：

- `PROJECT_MANIFEST.json.current_stage`
- `PROJECT_MANIFEST.json.owner_agent`
- `PROJECT_MANIFEST.json.next_action`
- `PROJECT_MANIFEST.json.blocking_reason`

### 4.2 不把 mailbox 改造成 task board

理由：

- mailbox 当前有自动 ack
- mailbox 语义是消息，不是 DAG
- mailbox item 没有 lease / dependency / verify policy

### 4.3 不把 runtime queue 改造成 task graph

理由：

- queue 表达的是 run/dispatch intent
- task graph 需要长期状态、依赖、claim、reopen

### 4.4 不第一步就全量 team 化所有 stage

理由：

- 当前 pipeline 内核还没收束
- 如果先全量 team 化，只会把重复逻辑扩散到更多 stage

### 4.5 不把 top-tier evidence loops 塞回旧状态块里

理由：

- `research_program` 适合承载问题、track、baseline、metric、required ablations 的 program-level contract，不适合继续塞 benchmark lock、statistical aggregation、venue competition、repro pack、camera-ready pack。
- `experiment_review_state` 适合承载 pre-launch review round，不适合膨胀成整个 evidence moat registry。
- `paper_story_state`、`review_pressure_packet`、`paper_qc`、`figure_qc` 应消费 evidence contracts，而不应自己充当这些 contracts 的唯一真相源。

因此这次重构应新增独立 evidence contracts，而不是继续把所有能力塞回既有 manifest 块中。

---

## 5. 重构后的模块边界

### 5.1 建议新增的目录结构

#### `tools/workflow-kernel/`

- `stage-registry.ts`
- `graph-context.ts`
- `readiness.ts`
- `transitions.ts`
- `closeout.ts`
- `stage-actions.ts`

#### `tools/workflow-collaboration/`

- `mailbox.ts`
- `contacts.ts`
- `handoff-policy.ts`
- `handoff-runtime.ts`

#### `tools/workflow-execution/`

- `runtime-store.ts`
- `dispatch-plan.ts`
- `delivery-adapter.ts`
- `background-pool.ts`
- `transition-orchestrator.ts`

#### `tools/workflow-projection/`

- `snapshot.ts`
- `status-text.ts`
- `dashboard-summary.ts`
- `runtime-health.ts`

#### `tools/workflow-evidence/`

- `papernexus-bridge.ts`
- `benchmark-registry.ts`
- `protocol-lock.ts`
- `statistics.ts`
- `venue-competition.ts`
- `ablation-sufficiency.ts`
- `mechanism-packet.ts`
- `reproducibility-pack.ts`
- `camera-ready-pack.ts`
- `opportunity-model.ts`

#### `tools/workflow-team/`

- `team-round.ts`
- `task-graph.ts`
- `task-claim.ts`
- `task-hooks.ts`
- `stage-profiles.ts`

### 5.2 现有文件的角色变化

- `tools/workflow-guard.ts`
  - 变成 facade，不再承载大量业务 helper
- `tools/register-workflow-tools.ts`
  - 只保留 tool action registration 与 adapter glue
- `tools/register-workflow-service.ts`
  - 只保留 service polling / scheduling glue
- `tools/workflow-fast-paths.ts`
  - 拆掉 background queue/store/pool 细节，只保留 slash-command background request builder
- `tools/workflow-guard-project/snapshot-builder.ts`
  - 改成纯 projection adapter
- `tools/register-workflow-hooks.ts`
  - 改成 hook adapter，不直接承载 handoff/runtime 事实

---

## 6. 重构优先级判断

### Priority 0: 先锁行为

在任何重构前，先把以下测试当成保护网：

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-fast-paths.test.mjs`
- `tests/workflow-runtime-orchestrator.test.mjs`
- `tests/workflow-guard-snapshot-builder.test.mjs`
- `tests/lobster-handoff.test.mjs`
- `tests/agent-task-dispatch.test.mjs`

### Priority 1: 先收束重复，不先加新能力

先做：

- kernel extraction
- duplicated helper elimination
- runtime payload unification
- collaboration boundary clarification

再做：

- top-tier evidence contracts
- Team Runtime

### Priority 2: 先把 top-tier evidence loops 做成 workflow contracts

优先顺序直接沿用 `top-tier-paper-gap-analysis.md` 的 leverage 判断：

1. benchmark registry + protocol lock
2. statistical aggregation + confidence artifacts
3. venue-competitive novelty / competitor scorecard
4. ablation sufficiency + mechanism evidence
5. release-grade reproducibility pack
6. camera-ready evidence materialization
7. top-tier bet / opportunity kill gate

### Priority 3: Team Runtime 只 pilot 到少数阶段

首批只 pilot：

- `experiment`
- `analyze`
- `review`

---

## 7. Planned File Map

### New files

- `tools/workflow-kernel/stage-registry.ts`
- `tools/workflow-kernel/graph-context.ts`
- `tools/workflow-kernel/readiness.ts`
- `tools/workflow-kernel/transitions.ts`
- `tools/workflow-kernel/closeout.ts`
- `tools/workflow-collaboration/mailbox.ts`
- `tools/workflow-collaboration/contacts.ts`
- `tools/workflow-collaboration/handoff-policy.ts`
- `tools/workflow-execution/runtime-store.ts`
- `tools/workflow-execution/dispatch-plan.ts`
- `tools/workflow-execution/delivery-adapter.ts`
- `tools/workflow-execution/background-pool.ts`
- `tools/workflow-execution/transition-orchestrator.ts`
- `tools/workflow-projection/snapshot.ts`
- `tools/workflow-projection/status-text.ts`
- `tools/workflow-evidence/papernexus-bridge.ts`
- `tools/workflow-evidence/benchmark-registry.ts`
- `tools/workflow-evidence/protocol-lock.ts`
- `tools/workflow-evidence/statistics.ts`
- `tools/workflow-evidence/venue-competition.ts`
- `tools/workflow-evidence/ablation-sufficiency.ts`
- `tools/workflow-evidence/mechanism-packet.ts`
- `tools/workflow-evidence/reproducibility-pack.ts`
- `tools/workflow-evidence/camera-ready-pack.ts`
- `tools/workflow-evidence/opportunity-model.ts`
- `tools/workflow-team/team-round.ts`
- `tools/workflow-team/task-graph.ts`
- `tools/workflow-team/task-claim.ts`
- `tools/workflow-team/task-hooks.ts`
- `tools/workflow-team/stage-profiles.ts`
- `tests/workflow-kernel-refactor.test.mjs`
- `tests/workflow-execution-kernel.test.mjs`
- `tests/workflow-collaboration-kernel.test.mjs`
- `tests/workflow-evidence-kernel.test.mjs`
- `tests/workflow-team-runtime.test.mjs`
- `tests/workflow-task-claim.test.mjs`
- `tests/workflow-team-recovery.test.mjs`

### Modified files

- `tools/workflow-guard.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-fast-paths.ts`
- `tools/workflow-background-pool.ts`
- `tools/workflow-runtime-state.ts`
- `tools/workflow-handoff-runtime.ts`
- `tools/workflow-guard-collaboration.ts`
- `tools/agent-task-dispatch.ts`
- `tools/lobster-handoff.ts`
- `tools/workflow-guard-project/snapshot-builder.ts`
- `tools/register-workflow-hooks.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/papernexus-progress.ts`
- `tools/papernexus-packets/materializer.ts`
- `tools/workflow-guard-policies/role-policy.ts`
- `tools/workflow-guard-stages/execution-stage-signals.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- `tools/workflow-guard-materializers/paper-story-materializer.ts`
- `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- `tools/workflow-guard-writing/paper-quality-eval.ts`
- `tools/workflow-guard-writing/citation-theory-eval.ts`
- `templates/PROJECT_MANIFEST.json`
- `tools/workflow-commands/formatters.ts`
- `apps/workflow-dashboard/server/read-models/project-detail.ts`
- `apps/workflow-dashboard/server/read-models/project-overview.ts`
- `apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx`
- 对应测试与文档

### Deletion / Shrink Targets

- `tools/workflow-guard.ts` 目标降到 facade 规模，不再承载重复 validation/snapshot helper
- `tools/workflow-fast-paths.ts` 删除 background store/pool 的重复实体定义
- `tools/register-workflow-service.ts` 删除 handoff/runtime 执行细节，只保留 service glue
- `tools/workflow-guard-project/snapshot-builder.ts` 删除与 `workflow-guard.ts` 重复的域 helper

---

## 8. Task 1: 锁定 pipeline 重构的行为边界

**目标：** 先证明重构不会改写 stage truth、dispatch truth 和 dashboard truth。

**Files:**

- Create: `tests/workflow-kernel-refactor.test.mjs`
- Modify: 现有 workflow 核心测试套件

- [ ] **Step 1: 写失败测试，锁定 stage truth 仍由 auto iterator 决定**

覆盖：

- `stageAfter`
- `ownerAfter`
- rollback / regression
- gate blocking
- closeout eligibility

- [ ] **Step 2: 写失败测试，锁定 mailbox / queue / dashboard 各自职责不变**

覆盖：

- mailbox 仍是 handoff/blocker/request/note
- runtime queue 仍是 dispatch/background intent
- dashboard 仍是只读 projection

- [ ] **Step 3: 写失败测试，锁定 native / lobster fallback 不回归**

---

## 9. Task 2: 提取 Workflow Fact Kernel

**目标：** 先解决 `workflow-guard.ts` 与 `snapshot-builder.ts` 的重复域逻辑问题。

**Files:**

- Create: `tools/workflow-kernel/stage-registry.ts`
- Create: `tools/workflow-kernel/graph-context.ts`
- Create: `tools/workflow-kernel/readiness.ts`
- Create: `tools/workflow-kernel/transitions.ts`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/papernexus-progress.ts`
- Modify: `tools/papernexus-packets/materializer.ts`

- [ ] **Step 1: 抽出 StageDefinition / StageRegistry**

统一承载：

- owner
- nextStage
- stage line
- stage closeout contract
- team runtime support policy

- [ ] **Step 2: 把重复 helper 收束进 Fact Kernel**

优先迁移重复 helper：

- onboarding gaps/status
- plan validation
- brainstorm validation
- innovation reflection due
- shell argument / stage command helpers

- [ ] **Step 3: 让 auto iterator / snapshot / stage-preflight 都依赖同一套 kernel**

目标：

- 不再各自复制 stage judgment
- 不再各自复制 validation helper

- [ ] **Step 4: 抽出统一的 graph context adapter，明确 PaperNexus 只作为 graph-sensitive 输入层**

要求：

- `graph_build` / `frontier_mapping` / `idea` 相关判断统一通过 `graph-context.ts`
- 统一消费：
  - graph presence
  - PaperNexus progress
  - packet materialization
  - graph freshness / refresh required
- 不让 domain kernel 直接散落调用多种 PaperNexus helper
- graph context 输出必须区分：
  - `ready`
  - `stale`
  - `missing`
  - `unavailable`

当前进展：

- 已完成：`graph-context.ts` 已落地，`auto_iterator` 已改走统一 graph context，并通过回归测试。
- 未完成：`snapshot-builder`、`stage-preflight` 的 graph-sensitive 判断仍未完全统一到同一适配层；`papernexus-progress` / packet materializer 侧仍有进一步收束空间。

### 9.1 合理性判断

这一步是 **高价值且低争议** 的，因为当前重复已经是明牌问题。

---

## 10. Task 3: 提取 Workflow Collaboration Kernel

**目标：** 把 mailbox / contact cooldown / handoff policy 从当前分散的实现中收束出来。

**Files:**

- Create: `tools/workflow-collaboration/mailbox.ts`
- Create: `tools/workflow-collaboration/contacts.ts`
- Create: `tools/workflow-collaboration/handoff-policy.ts`
- Modify: `tools/workflow-guard-collaboration.ts`
- Modify: `tools/workflow-handoff-runtime.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `tools/register-workflow-service.ts`

- [ ] **Step 1: mailbox/store 操作统一到 collaboration kernel**

包括：

- read/write mailbox
- enqueue
- ack
- dedupe

- [ ] **Step 2: contact cooldown 统一到 collaboration kernel**

不再让 hooks/service/tool 各自理解联络语义。

- [ ] **Step 3: handoff policy 统一输出**

统一决定：

- 谁可联系谁
- 何时应该 mailbox handoff
- 何时不应直接 `sessions_send`

### 10.1 合理性判断

这一步也很合理，因为当前 mailbox/handoff 链路已经跨了 6 个文件，继续叠 Team Runtime 只会更乱。

---

## 11. Task 4: 提取 Workflow Execution Kernel

**目标：** 统一 runtime queue/session、background pool、dispatch plan、delivery adapter。

**Files:**

- Create: `tools/workflow-execution/runtime-store.ts`
- Create: `tools/workflow-execution/dispatch-plan.ts`
- Create: `tools/workflow-execution/delivery-adapter.ts`
- Create: `tools/workflow-execution/background-pool.ts`
- Create: `tools/workflow-execution/transition-orchestrator.ts`
- Modify: `tools/workflow-runtime-state.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/workflow-background-pool.ts`
- Modify: `tools/agent-task-dispatch.ts`
- Modify: `tools/lobster-handoff.ts`
- Modify: `tools/register-workflow-service.ts`

- [ ] **Step 1: 消除 duplicated queue/session payload types**

统一：

- queue entry
- dispatch payload
- session lease payload

- [ ] **Step 2: 让 fast-paths 只保留 request builder，不再自带一套 execution store 语义**

当前 `workflow-fast-paths.ts` 同时做了：

- command builder
- queue store
- session lease
- recovery glue

这必须拆开。

- [ ] **Step 3: delivery adapter 统一 native / lobster / spawn fallback**

让 `agent-task-dispatch.ts` 与 `lobster-handoff.ts` 不再各自承载过多 orchestration 判断。

### 11.1 合理性判断

这是这次重构的关键收益点之一。因为今天如果不先统一 execution kernel，后面的 Team Runtime 根本没有一个稳定的执行底盘可挂。

---

## 12. Task 5: 提取 Workflow Projection Kernel

**目标：** 让 snapshot、status 文本、dashboard 都读同一套投影，而不是各自拼装。

**Files:**

- Create: `tools/workflow-projection/snapshot.ts`
- Create: `tools/workflow-projection/status-text.ts`
- Create: `tools/workflow-projection/dashboard-summary.ts`
- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-commands/formatters.ts`
- Modify: dashboard read-models

- [ ] **Step 1: snapshot 从 domain kernel 读取，而不是自己重做 validation**

- [ ] **Step 2: status formatter 从 projection kernel 读取，而不是重推导状态**

- [ ] **Step 3: dashboard read-model 改成消费 projection，而不是直接拼 manifest + incidental files**

### 12.1 合理性判断

这一步很重要，因为 Team Runtime 一旦引入 task graph，如果 dashboard 还沿用现在的“直接读 manifest/raw files 拼 summary”模式，可观察性会立刻掉队。

---

## 13. Task 6: 引入 Top-Tier Evidence Contracts

**目标：** 把当前只以 skill / review 提醒 / prompt guidance 形式存在的高标准证据要求，升级成 workflow-owned contracts，并把它们接进 stage closeout、review、writing 与 top-tier bet gating。

**Files:**

- Create: `tools/workflow-evidence/papernexus-bridge.ts`
- Create: `tools/workflow-evidence/benchmark-registry.ts`
- Create: `tools/workflow-evidence/protocol-lock.ts`
- Create: `tools/workflow-evidence/statistics.ts`
- Create: `tools/workflow-evidence/venue-competition.ts`
- Create: `tools/workflow-evidence/ablation-sufficiency.ts`
- Create: `tools/workflow-evidence/mechanism-packet.ts`
- Create: `tools/workflow-evidence/reproducibility-pack.ts`
- Create: `tools/workflow-evidence/camera-ready-pack.ts`
- Create: `tools/workflow-evidence/opportunity-model.ts`
- Modify: `templates/PROJECT_MANIFEST.json`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`
- Modify: `tools/workflow-guard-stages/writing-stage-signals.ts`
- Modify: `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- Modify: `tools/workflow-guard-writing/paper-quality-eval.ts`
- Modify: `tools/workflow-guard-writing/citation-theory-eval.ts`
- Modify: `tools/workflow-commands/formatters.ts`

- [ ] **Step 1: 新增独立 evidence state contracts，而不是继续塞回旧状态块**

建议新增 manifest blocks：

- `benchmark_protocol`
- `statistical_evidence`
- `venue_competition`
- `ablation_evidence`
- `mechanism_evidence`
- `reproducibility_pack`
- `camera_ready_evidence`
- `opportunity_scorecard`

要求：

- 不重载 `research_program`
- 不重载 `experiment_review_state`
- 不让 `paper_story_state` / `paper_qc` / `figure_qc` 继续兼任证据真相源

当前进展：

- 已完成前置桥接：`papernexus-bridge.ts` 已落地，并把 workflow-owned PaperNexus packet/bundle 的检测从 `stage-preflight` 里抽离。
- 未完成：manifest evidence state blocks 还没有正式加到 schema，也还没接进 closeout / review / writing gates。

- [ ] **Step 2: Benchmark registry + protocol lock**

让 workflow 能 first-class 表达：

- canonical benchmark family
- official split / checksum
- official eval script / metric recipe
- allowed deviations
- leaderboard comparison policy
- protocol drift detection

PaperNexus 辅助边界：

- **辅助但不是权威**
- 可以用来：
  - 发现 benchmark family
  - 收集近邻论文的 protocol variants
  - 发现常见 leaderboard comparison assumptions
- 不可以用来：
  - 直接替代本地 protocol lock
  - 直接决定项目最终采用哪一个 split / eval recipe

- [ ] **Step 3: Statistical aggregation + claim-strength gate**

materialize：

- multi-seed aggregate tables
- mean / std / CI
- effect size
- significance artifacts
- claim-strength upgrade/downgrade

并让 analyze/review/write 阶段消费这套状态，而不是只在自然语言里“提醒要看显著性”。

- [ ] **Step 4: Venue-competitive positioning contract**

materialize：

- target-venue competitor slate
- nearest-paper comparison deltas
- acceptance-risk scorecard
- novelty kill-switch

把当前 novelty-aware 流水线升级成 acceptance-aware 流水线。

PaperNexus 辅助边界：

- **这里是强依赖**
- 需要 graph-backed competitor discovery、nearest-paper retrieval、prior-art delta grounding
- 若 PaperNexus 不可用，可生成草稿 scorecard，但状态必须是 `unverified_graph_context`，不能通过 top-tier novelty / venue-competition gate

- [ ] **Step 5: Ablation sufficiency + mechanism-evidence loop**

materialize：

- required vs optional ablations
- objection-to-ablation mapping
- mechanism-targeted ablation templates
- mechanism packet
- ablation -> causal explanation bridge

PaperNexus 辅助边界：

- **建议强辅助**
- 可用于：
  - 抽取近邻论文的常见 reviewer objection
  - 发现常见 mechanism explanations / failure modes
  - 生成 objection -> ablation mapping 初稿
- 但最终 sufficiency 与 mechanism verdict 必须基于本地实验与 analyzer packet，不能只基于 graph prior

- [ ] **Step 6: Reproducibility pack + camera-ready evidence pack**

materialize：

- environment / dependency / hardware capture
- supplementary / release artifact bundle
- result-to-table-to-figure-to-caption packet
- camera-ready section packet readiness

PaperNexus 辅助边界：

- **这里不应成为关键依赖**
- reproducibility 与 camera-ready pack 的权威来源应始终是项目本地 artifacts
- PaperNexus 最多用于 related-work / benchmark naming / citation context 辅助，不参与最终通过判定

- [ ] **Step 7: Top-tier bet / opportunity kill gate**

让 ideation / plan / review 可以明确得出：

- worth_top_tier_bet
- strong_but_incremental
- workshop_grade
- not_worth_current_cycle

PaperNexus 辅助边界：

- **这里是强依赖**
- opportunity model 必须吸收：
  - crowdedness / competitor density
  - nearest-paper deltas
  - venue-facing novelty pressure
- 若 graph context 不可用，则不能给出 `worth_top_tier_bet` 正结论

### 13.1 合理性判断

这一步不是“以后再加的研究质量优化”，而是这次重构必须提前纳入的主线。因为 Team Runtime 只是把阶段内执行做得更顺；如果 evidence moat contract 仍然缺位，系统最多也只是更高效地生产“结构化但未必顶会级”的结果。

---

## 14. Task 7: 把 stage closeout 接到 evidence moat gates 上

**目标：** 让阶段关闭条件从“artifact exists + basic readiness”升级成“artifact + evidence quality + top-tier bet consistency”。

**Files:**

- Modify: `tools/workflow-kernel/closeout.ts`
- Modify: `tools/workflow-kernel/readiness.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`
- Modify: `tools/workflow-guard-stages/writing-stage-signals.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`

- [ ] **Step 1: `experiment -> analyze` 接 benchmark/statistics/ablation evidence**

PaperNexus 说明：

- benchmark family / protocol context 可辅助接入
- 但统计聚合与 ablation 结果本身来自本地实验 artifacts
- 不应因为 PaperNexus 短时不可用而阻止本地统计聚合完成；应只把 graph-backed comparison/benchmark context 标为待补

- [ ] **Step 2: `analyze -> review` 接 mechanism/competitor slate**

PaperNexus 说明：

- 这里必须有 graph-backed competitor slate 与 mechanism prior，才能通过 top-tier review path
- 如果缺失，应允许进入本地 review，但不能标记为 top-tier-ready

- [ ] **Step 3: `review -> write` 接 venue competition / top-tier bet / reproducibility readiness**

PaperNexus 说明：

- venue competition / top-tier bet 依赖 PaperNexus
- reproducibility readiness 不依赖 PaperNexus
- 这两个 gate 必须分开，避免本地复现准备被图谱依赖绑死

- [ ] **Step 4: `write -> submit` 接 camera-ready evidence pack 与 supplementary readiness**

PaperNexus 说明：

- 这里的主 gate 是本地 camera-ready / supplementary readiness
- PaperNexus 只用于最终 related-work / benchmark naming / citation context 的一致性检查，不应成为提交级主阻塞项

### 14.1 合理性判断

如果不把 closeout 接到 evidence contracts，上面的新增状态最终只会变成“更完整的元数据”，而不是 workflow 真正会用来推进/阻塞的 contracts。

---

## 15. Task 8: 在新内核上引入 Team Runtime

**目标：** 这一步才真正引入 Agent Teams 风格的阶段内推进。

**Files:**

- Create: `tools/workflow-team/team-round.ts`
- Create: `tools/workflow-team/task-graph.ts`
- Create: `tools/workflow-team/task-claim.ts`
- Create: `tools/workflow-team/task-hooks.ts`
- Create: `tools/workflow-team/stage-profiles.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/register-workflow-hooks.ts`

- [ ] **Step 1: 只在试点 stage materialize stage-scoped task graph**

首批：

- `experiment`
- `analyze`
- `review`

- [ ] **Step 2: claim / lease / verify / reopen**

task state 统一支持：

- claimable
- claimed
- in_progress
- verifying
- completed
- needs_repair
- blocked

- [ ] **Step 3: TeammateIdle 闭环**

agent 完成一个 task 后：

- 先 verify
- 再解锁依赖
- 再 self-claim 下一个可做 task
- 没有时才 idle

### 15.1 这里为什么现在才做

因为如果没有前面的 pipeline kernel 重构和 evidence contracts，Team Runtime 会直接依附在一套职责混杂、且缺少高标准证据闭环的实现上，后果就是复杂度再次指数上升，同时也只是更高效地推进中等质量产物。

---

## 16. Task 9: Role-Aware Stage Lead 与 Session Pool

**目标：** 避免 Team Runtime 最终仍退化成 researcher 中央调度。

**Files:**

- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-execution/background-pool.ts`
- Modify: `tools/workflow-subagent-sessions.ts`
- Modify: `tools/workflow-guard-policies/role-policy.ts`

- [ ] **Step 1: stage lead 一律来自 StageRegistry/owner_agent**

- [ ] **Step 2: pooled session policy 从 researcher-only 变成 role-aware**

- [ ] **Step 3: 保留 researcher slash fast path，但不让 researcher 再代理所有阶段的微观推进**

---

## 17. Task 10: Dashboard 补 Team Runtime 与 Evidence Runtime 可观察性

**目标：** 把 Team Runtime 和 Evidence Runtime 做成可运营系统，而不是隐形状态机。

**Files:**

- Modify: `apps/workflow-dashboard/server/read-models/project-detail.ts`
- Modify: `apps/workflow-dashboard/server/read-models/project-overview.ts`
- Modify: `apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx`
- Modify: 相关组件和测试

- [ ] **Step 1: 增加 Team Round 概览**

显示：

- lead role
- active tasks
- blocked tasks
- completed tasks
- closeout pending

- [ ] **Step 2: 增加 Task Board**

显示：

- task status
- claimant
- dependsOn
- verification status
- latest event

- [ ] **Step 3: 增加 Evidence Moat 概览**

显示：

- benchmark protocol lock
- statistical evidence quality
- venue competition score
- ablation sufficiency
- mechanism packet status
- reproducibility pack
- camera-ready evidence pack
- top-tier bet status

- [ ] **Step 4: 保持 dashboard 只读**

---

## 18. Migration Strategy

### Phase 0

- 锁回归
- 提炼重复 helper
- 不改用户可见行为

### Phase 1

- workflow fact kernel
- collaboration kernel
- execution kernel
- projection kernel

### Phase 2

- evidence contracts
- stage closeout 接 evidence gates

### Phase 3

- Team Runtime pilot 到 `experiment`

### Phase 4

- 扩到 `analyze` / `review`
- dashboard 补 task board + evidence board

### Phase 5

- 再评估是否扩到 `idea` / `graph_build`
- `write` / `survey_review` 单独设计，不自动跟随

---

## 19. Acceptance Criteria

- [ ] `workflow-guard.ts` 明显收缩为 facade，不再承载大量重复域 helper。
- [ ] `snapshot-builder.ts` 不再复制 onboarding / plan / brainstorm / reflection 逻辑。
- [ ] graph-sensitive 判断统一经由 `graph-context` / `papernexus-bridge` 输出，不再在各处直接散落读取 PaperNexus 状态。
- [ ] execution queue/session/pool payload 使用统一 schema，不再在 fast-paths 中重复定义。
- [ ] mailbox / handoff / contact cooldown 由统一 collaboration kernel 提供。
- [ ] native / lobster / spawn fallback 由统一 delivery adapter 路由。
- [ ] dashboard 与 snapshot 读同一套 projection kernel。
- [ ] benchmark protocol lock、statistical evidence、venue competition、ablation/mechanism evidence、reproducibility pack、camera-ready evidence、top-tier bet gate 都成为 workflow-owned contracts。
- [ ] plan 中所有需要 PaperNexus 强辅助的 contracts 都明确了 degrade 语义，graph 不可用时不会伪装成已 graph-grounded。
- [ ] `experiment -> analyze -> review -> write -> submit` 的 closeout 判断可消费这些 evidence contracts，而不是只看文件存在性。
- [ ] Team Runtime 启用后，试点 stage 内至少支持两个 teammate 并行 claim 不同 task。
- [ ] teammate 完成 task 后，如仍有可做工作，可自动继续，无需 lead 再次显式派发。
- [ ] 关闭 Team Runtime feature flag 后，现有 stage handoff path 保持可用。

---

## 20. Verification Plan

### 核心测试

- `node --test tests/auto-iterator.test.mjs`
- `node --test tests/workflow-runtime-tools.test.mjs`
- `node --test tests/workflow-service.test.mjs`
- `node --test tests/workflow-fast-paths.test.mjs`
- `node --test tests/workflow-runtime-orchestrator.test.mjs`
- `node --test tests/workflow-guard-snapshot-builder.test.mjs`
- `node --test tests/lobster-handoff.test.mjs`
- `node --test tests/agent-task-dispatch.test.mjs`

### 新增测试

- `node --test tests/workflow-kernel-refactor.test.mjs`
- `node --test tests/workflow-execution-kernel.test.mjs`
- `node --test tests/workflow-collaboration-kernel.test.mjs`
- `node --test tests/workflow-evidence-kernel.test.mjs`
- `node --test tests/workflow-team-runtime.test.mjs`
- `node --test tests/workflow-task-claim.test.mjs`
- `node --test tests/workflow-team-recovery.test.mjs`

### PaperNexus 相关验证

- graph available 时：
  - competitor slate / opportunity scorecard / graph-backed mechanism prior 能正常 materialize
- graph unavailable 时：
  - `venue_competition` / `opportunity_scorecard` / graph-backed `mechanism_evidence` 会进入 `unverified_graph_context`
  - 本地统计、复现、camera-ready pack 仍可继续推进
- graph 恢复后：
  - closeout gate 能从 degraded graph state 正常恢复

### Dashboard

- `npm run dashboard:test`

---

## 21. 风险与缓解

### 风险 1：重构过大，导致阶段推进逻辑回归

缓解：

- 先抽 kernel，再改调用方
- 每个 kernel 提取都先写 adapter tests

### 风险 2：重构后只“换目录”，没有实质降复杂度

缓解：

- 明确 shrink target
- 重复 helper 必须删除旧实现
- fast-paths / service / guard 不允许继续保留平行 payload model

### 风险 3：Team Runtime 仍被 researcher 中央化

缓解：

- stage lead 来自 stage registry
- role-aware pooled session

### 风险 4：dashboard 继续读旧状态，导致新 runtime 不可见

缓解：

- projection kernel 先于 Team Runtime 落地

### 风险 5：evidence contracts 变成“只记录不驱动”的摆设

缓解：

- 必须把它们接进 closeout / review / write gate
- 不允许只 materialize 不 gating

### 风险 6：top-tier evidence 要求全量压到所有项目，导致普通项目阻塞

缓解：

- `opportunity_scorecard` 区分：
  - top-tier bet
  - strong incremental
  - workshop-grade
  - not worth current cycle
- 只有 top-tier bet 项目才启用最严格 evidence gates

---

## 22. 最终判断

基于当前代码库，这次更合理的方向不是：

- “直接把 Claude Agent Teams 机制贴到现有 pipeline 上”

而是：

- “先把现有 pipeline 重构成统一 Workflow Kernel，再把 top-tier evidence loops 做成 first-class contracts，最后把 Agent Teams 式推进机制作为 stage runtime 落在其上”

换句话说：

- **Pipeline Kernel Refactor 是先决条件**
- **Evidence Moat Contracts 是质量闭环**
- **Team Runtime 是推进能力**

这比上一个版本更激进，但也更贴合当前 `openclaw-research` 的真实结构问题。只有这样做，后面的 handoff、持续推进、并行 task、idle continuation 才不会再次落进现在这套分散职责的实现里；同时也不会只是更高效地推进“结构化但证据 moat 不够强”的研究流程。
