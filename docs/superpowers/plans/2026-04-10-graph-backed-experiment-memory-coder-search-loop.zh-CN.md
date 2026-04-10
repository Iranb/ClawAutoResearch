# Graph-Backed Experiment Memory 与 Coder Search Loop 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“固定创新方向下的实验微循环”安全地下放给 `coder`，同时让这些实验不只是停留在本地 `ledger`，而是被提炼成可检索、可反思、可跨轮次复用的 graph-backed experiment memory。

**Architecture:** 保持现有顶层阶段机不变，继续以本地 durable state 作为运行时权威来源，但在 `experiment` 内加入一个“approved search envelope -> coder local search -> reconcile -> graph sync -> reflection-ready”的内循环。`EXPERIMENT_LEDGER.json`、bundle manifest、`SEARCH_STATE.json` 负责精确记录“系统做了什么”；PaperNexus 负责承载被提炼后的“为什么有效 / 为什么失败 / 下轮应该尊重什么约束”的共享实验记忆。Graph sync 采用 local-first、event-driven、distilled-second 的模式，而不是把原始日志直接倒进图谱。

**Tech Stack:** TypeScript, Node.js built-in test runner, existing `research_workflow` / `research_memory` runtime tools, workflow guard/runtime/service modules, PaperNexus remote HTTP MCP, markdown workflow docs

---

## Problem Summary

当前系统已经有两块很强的基础，但它们还没有真正闭环：

1. `coder` 侧已经有 baseline-first、one-variable-per-experiment、bundle manifest、remote launch 等约束。
2. `researcher` / `PaperNexus` 侧已经有 `EXPERIMENT_LEDGER.json`、`innovation_reflection`、graph-grounded ideation。

真正缺的是中间层：

- 哪些 experiment evidence 该留在本地 runtime state，哪些应该升格为 graph memory
- `coder` 在做局部实验搜索时，如何消费过去的 graph-backed failure/win patterns
- graph memory 如何回流到下一轮 `experiment-plan`、`search envelope`、`innovation-reflection`

结果就是现在的“实验记忆”还是偏 ledger-first、reflection-second，而不是“运行时精确、反思时可检索、下轮可复用”的统一内循环。

---

## Design Rules

1. **Runtime truth stays local.** 活跃运行期间，权威来源仍然是 `{PROJ}/researcher/EXPERIMENT_LEDGER.json`、`{PROJ}/coder/.../EXPERIMENT_MANIFEST.json`、`SEARCH_STATE.json`，不是 PaperNexus。
2. **Graph memory is distilled, not raw.** 不把原始日志、全量 stdout、每一步 shell 操作直接灌进图谱；只同步结构化、可比较、会影响后续搜索与 ideation 的实验记忆。
3. **One search envelope, many coder trials.** reviewed-auto 不应审批每一个微实验，而应审批一个 bounded `search_envelope`；只要 `coder` 不越界，就允许连续试错。
4. **Baseline-first remains the invariant.** graph-backed experiment memory 必须保留 baseline anchor、comparison target、fairness contract，不能只存“最优结果”。
5. **Graph sync is non-blocking for analyze, but blocking for fresh ideation when stale.** `experiment -> analyze` 不必因为 graph sync 未完成而卡死；但下一轮 serious ideation 前，新的关键实验 evidence 必须完成 graph-backed reflection。
6. **Coder consumes compact packets, not live graph by default.** 默认由 workflow materialize 一个面向 `coder` 的 compact experiment-memory packet，避免在每个 candidate loop 都打 live graph。
7. **Failure memory matters as much as success memory.** 决定下轮 search envelope 的，不只是 best config，也包括“不要再试什么”和“什么 failure signature 代表应该收缩搜索空间”。
8. **Git is the acceptance gate, not just a backup log.** `coder` 的实验内循环必须通过 git 管理：只有命中晋升规则的改动才允许进入 track 的 incumbent 历史；未晋升 candidate 必须通过临时分支 / worktree 回退，不得污染主实验分支。
9. **Secondary signals cannot promote code.** 像 train/val gap 缩小、loss 曲线更平滑、运行更稳定、局部 checkpoint 看起来更好，这些只能作为诊断信号或下一 candidate 的启发；除非它们就是 packet 明确声明的主指标，否则都不能单独成为保留 git commit 的理由。

---

## Scope Summary

这份计划把集成拆成三层合同：

### 1. Local Execution Memory

- `researcher/EXPERIMENT_LEDGER.json`
- `coder/experiments/.../EXPERIMENT_MANIFEST.json`
- `planner/EXPERIMENT_SEARCH_SPEC.json`
- `coder/experiments/.../SEARCH_STATE.json`
- git branch / commit lineage for the search session

作用：精确表达 search session、candidate run、incumbent、promotion/rollback 和远程执行状态。

### 2. Graph Bridge Artifacts

- `researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json`
- `researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json`
- `researcher/INNOVATION_REFLECTION.md`

作用：把本地 experiment memory 提炼成 graph-facing packet，并把 graph-backed takeaway 再压回 workflow。

### 3. Shared PaperNexus Memory Layer

- 共享的 experiment / baseline / hypothesis / outcome / failure / reflection overlay

作用：支持下一轮的：

- search envelope narrowing
- baseline choice refinement
- failure avoidance
- transfer pattern retrieval
- innovation reflection

---

## Target Operating Model

### A. Planner / Researcher owns the outer loop

外层仍由 `planner` / `researcher` 决定：

- 当前 active track
- baseline 与 fairness contract
- 允许搜索的参数/开关/repair 维度
- stop rules
- compute budget
- 何时结束 search round

### B. Coder owns the inner loop

`coder` 不再只做一次性 bundle 实现和原子 launch，而是在已批准的 envelope 里执行一个 bounded search loop：

1. 读取 `EXPERIMENT_SEARCH_SPEC.json`
2. 读取 graph-backed `EXPERIMENT_MEMORY_PACKET.json`
3. 从 incumbent commit 派生一个临时 git candidate 分支 / worktree
4. 生成下一个 candidate
5. dry-run / remote launch
6. 与 baseline / incumbent 比较
7. 只有命中 promotion rule 才允许把 candidate commit 合入 incumbent 历史
8. 未命中则丢弃 candidate 分支，只在 `SEARCH_STATE.json` 与 ledger 里留下结构化记录
9. 更新 `SEARCH_STATE.json`、manifest、ledger
10. 直到命中 budget / patience / stop rule

### C. Researcher reconciles and syncs

`researcher` 在 search round 结束或出现关键事件后负责：

- ledger reconciliation
- graph sync materialization
- `innovation_reflection`
- track decision (`advance / park / kill / merge`)

---

## New / Updated Durable Contracts

## 1. `planner/EXPERIMENT_SEARCH_SPEC.json`

这是 reviewed-auto packet 对 `coder` 的“自治边界”。

建议字段：

```json
{
  "track_id": "track_xxx",
  "basis_packet_path": "planner/EXPERIMENT_REVIEW_PACKET.json",
  "search_session_id": "search_xxx",
  "search_mode": "local_hillclimb",
  "git_strategy": {
    "incumbent_branch": "experiment/track_xxx/incumbent",
    "candidate_branch_prefix": "experiment/track_xxx/candidate/",
    "require_clean_candidate_history": true,
    "promotion_commit_policy": "keep_only_metric_wins",
    "discard_unpromoted_candidates": true
  },
  "frozen_contract": {
    "dataset": "...",
    "primary_metric": "...",
    "baseline_reference": "...",
    "baseline_training_protocol": "...",
    "baseline_eval_protocol": "...",
    "claim_ids": []
  },
  "search_envelope": {
    "allowed_hyperparams": [],
    "allowed_switches": [],
    "allowed_repairs": [],
    "forbidden_changes": []
  },
  "comparison_policy": {
    "compare_against": "baseline_then_incumbent",
    "promotion_rule": "beat_incumbent_or_equal_simpler",
    "rollback_rule": "worse_or_unattributable",
    "non_promotion_signals": [
      "gap_reduction_only",
      "loss_curve_smoother_only",
      "runtime_nicer_without_metric_gain"
    ],
    "under_baseline_patience": 2,
    "no_improvement_patience": 3
  },
  "budget": {
    "max_runs": 8,
    "max_gpu_hours": 12,
    "max_parallel_runs": 2
  },
  "graph_memory_basis": {
    "packet_path": "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
    "reflection_path": "researcher/INNOVATION_REFLECTION.md"
  }
}
```

## 2. `coder/experiments/.../SEARCH_STATE.json`

这是 search round 的 runtime 记忆，而不是最终学术结论。

建议字段：

```json
{
  "search_session_id": "search_xxx",
  "track_id": "track_xxx",
  "status": "running",
  "incumbent_branch": "experiment/track_xxx/incumbent",
  "incumbent_commit": "abc1234",
  "incumbent_experiment_id": "exp_005",
  "baseline_experiment_id": "exp_001",
  "frontier_experiment_ids": [],
  "completed_experiment_ids": [],
  "failed_experiment_ids": [],
  "discarded_experiment_ids": [],
  "last_candidate_experiment_id": "exp_007",
  "last_candidate_branch": "experiment/track_xxx/candidate/exp_007",
  "last_candidate_commit": "def5678",
  "last_decision": "rollback",
  "graph_memory_packet_path": "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
  "last_graph_memory_refresh_at": null,
  "pending_reason": null,
  "last_updated_at": null
}
```

## 3. `researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json`

这是给 `planner` / `coder` / `innovation-reflection` 用的 compact retrieval packet，不是 PaperNexus 原始返回。

建议结构：

```json
{
  "track_id": "track_xxx",
  "baseline_reference": "...",
  "primary_metric": "...",
  "comparable_runs": [],
  "successful_patterns": [],
  "failure_patterns": [],
  "repair_patterns": [],
  "do_not_repeat_constraints": [],
  "open_frontiers": [],
  "graph_refs": [],
  "last_materialized_at": null,
  "reflected_through_experiment_update_at": null
}
```

其中最关键的不是“列出所有实验”，而是把实验压成：

- 哪些改动在什么条件下有用
- 哪些 failure signature 说明方向本身不值得继续烧算力
- 哪些 baseline drift / eval drift 经常造成伪提升
- 哪些 git lineage 被真正保留下来了，为什么被保留
- 哪些约束应该进入下轮 ideation / plan

## 4. `researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json`

这是 graph-bridge runtime 状态，不替代 ledger。

建议字段：

```json
{
  "status": "pending",
  "last_sync_started_at": null,
  "last_sync_completed_at": null,
  "pending_experiment_ids": [],
  "last_synced_experiment_ids": [],
  "last_packet_path": "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
  "pending_reason": null
}
```

---

## Graph Memory Model

这部分不要求一次性把 PaperNexus schema 做得非常重，但至少要有下面这些语义单元：

### Core entities

- `Track`
- `Hypothesis`
- `InnovationPoint`
- `BaselineContract`
- `GitLineage`
- `ExperimentBundle`
- `CandidateRun`
- `Outcome`
- `FailurePattern`
- `ReflectionConstraint`

### Minimum relations

- `ExperimentBundle -> tests -> Hypothesis`
- `ExperimentBundle -> scoped_by -> SearchEnvelope`
- `CandidateRun -> implemented_by -> GitLineage`
- `CandidateRun -> varies -> InnovationPoint`
- `CandidateRun -> compared_against -> BaselineContract`
- `CandidateRun -> yields -> Outcome`
- `Outcome -> supports/refutes -> Claim or InnovationPoint`
- `FailurePattern -> constrains -> SearchEnvelope`
- `ReflectionConstraint -> informs -> next Track / Idea / Plan`

### Important note

图谱里真正有价值的不是“run #17 的日志”，而是：

- 它相对 baseline 改了什么
- 它从哪个 incumbent commit 派生、最后是否进入保留历史
- 为什么保留 / 为什么回退
- 这个 decision 对下轮搜索边界有什么影响

---

## Git Ratchet Model

这部分是 `coder` search loop 的核心纪律。

### 1. Branch roles

- `experiment/<track-id>/incumbent`
  - 当前 track 的保留主线
  - 只包含已晋升的 commit
- `experiment/<track-id>/candidate/<experiment-id>`
  - 一次 candidate trial 的临时分支或 worktree
  - 跑完即合并或丢弃

### 2. Candidate lifecycle

1. 从 incumbent branch 的当前 commit 切出 candidate branch
2. `coder` 只在 candidate branch 上做改动
3. 本地 dry-run + 远程 eval
4. 根据 approved `promotion_rule` 判断：
   - 如果主指标有用提升，或“持平但更简单且规则允许”，则保留
   - 如果只是 gap 缩小、loss 更好看、启动更稳定、局部曲线更顺，则不保留
5. 保留时：
   - candidate commit 合入 incumbent branch
   - `SEARCH_STATE.json` 更新 `incumbent_commit`
6. 不保留时：
   - 删除 / 丢弃 candidate branch 或 worktree
   - 只在 ledger 和 packet 中记录 failure/diagnostic

### 3. Promotion constitution

默认只有下面两种情况允许改动进入 incumbent 历史：

- **Primary-metric win**
  - approved primary eval metric 明显优于 incumbent / baseline
- **Equal-but-simpler win**
  - 主指标不差于 incumbent
  - 复杂度、代码量、资源使用或 baseline fidelity 更好
  - 并且该保留规则在 packet 中被显式允许

默认不允许因为下面这些理由保留 commit：

- train/val gap 变小
- 中间 checkpoint 更好看但最终 eval 未提升
- 训练更稳但主指标没变
- 单次 seed 看起来更顺但 packet 要求的是 multi-seed
- “感觉更有希望”

### 4. Why git matters here

git 在这里不是普通版本控制，而是实验内循环的 **ratchet**：

- 让 search history 只积累“真正值得保留的局部改动”
- 让 graph memory 能区分“被保留的知识”与“仅供诊断的失败尝试”
- 让 `coder` 在持续试错时仍保持主线可读、可恢复、可反思

---

## Sync Granularity

不要把所有粒度都等价同步。

### 1. Candidate-level runtime events

保留在本地 state：

- launched
- running
- timeout
- crash
- quick rollback

默认只进 ledger，不立即写 graph。

### 2. Decision-worthy experiment memory

这些应该进入 graph sync 候选：

- promoted incumbent
- decisive discard with clear failure mode
- baseline parity restoration
- repair branch that changed the feasible search region
- experiment that changes the next plan or ideation boundary
- accepted git lineage transition（例如 incumbent commit 从 A 推进到 B）

### 3. Reflection-level distilled memory

这些必须进入 `INNOVATION_REFLECTION.md` 和 packet：

- repeated failures that imply “do not repeat”
- successful transferable patterns
- changed baseline expectations
- newly exposed confounds / fairness obligations

---

## Retrieval Integration

## 1. Planner usage

`/experiment-plan` 在生成 `EXPERIMENT_SEARCH_SPEC.json` 前，先读：

- `EXPERIMENT_LEDGER.json`
- `INNOVATION_REFLECTION.md`
- `EXPERIMENT_MEMORY_PACKET.json`

Planner 应该利用 graph-backed experiment memory 来回答：

- 这条 innovation point 之前在哪些条件下失败过
- 哪些 baseline drift 是高频伪改进来源
- 当前 envelope 应该收紧还是放宽
- 哪些 falsifier 和 stop rule 应该直接写进 packet

## 2. Coder usage

`coder` 默认不直接打 live graph，而是消费 compact packet：

- session start 时读一次
- promote incumbent 后可请求刷新一次
- 连续 under-baseline / repeated crash 时强制刷新一次

Coder 应该从 packet 中拿到：

- 优先尝试哪些小改动
- 哪些 failure pattern 应直接避免
- 哪些 repair branch 曾经有效
- 哪些比较对象必须保留
- 哪些历史 git lineage 是真正被接受过的，避免重复回滚同类 candidate

## 3. Innovation reflection usage

`/innovation-reflection` 不应只看 raw ledger。它应融合：

- raw ledger 里的真实 run history
- packet 里的 distilled pattern
- PaperNexus 里的 graph-backed external context

这样下一轮 ideation 才不会只做“本地经验总结”，而是做“实验证据 + 外部图谱”的联合反思。

---

## Stage Behavior Changes

## `code`

`coder` 在 bundle ready 之后，除了 `EXPERIMENT_MANIFEST.json` 外，还要准备：

- `EXPERIMENT_SEARCH_SPEC.json` 的引用位
- `SEARCH_STATE.json` 初始化位

## `experiment`

`experiment` micro-stage 建议扩成：

- `planning`
- `analyzer_review`
- `cross_review`
- `synthesis`
- `search_bootstrap`
- `search_running`
- `monitoring`
- `graph_sync_pending`
- `ready_for_analysis`

其中：

- `graph_sync_pending` 不应阻塞 `analyze`
- 但若关键 experiment evidence 已经改变创新边界，则必须让 `innovation_reflection` 在下一轮 `idea` 之前变 fresh

## `idea`

在 serious ideation 前新增一个更强的 freshness rule：

- 如果 `experiment_memory.papernexus_sync_required = true`
- 或 `innovation_reflection.reflected_through_experiment_update_at` 落后于 ledger 最新关键更新

则必须先跑：

- graph sync materialization
- `/innovation-reflection`

---

## Planned File Map

### New files

- `docs/superpowers/plans/2026-04-10-graph-backed-experiment-memory-coder-search-loop.zh-CN.md`
- `templates/EXPERIMENT_SEARCH_SPEC.json`
- `templates/SEARCH_STATE.json`
- `tools/workflow-guard-state/experiment-memory-graph.ts`
- `tools/workflow-guard-materializers/experiment-memory-packet-materializer.ts`
- `tools/workflow-auto-experiment-search.ts`
- `skills/coder/search-experiment/SKILL.md`
- `tests/graph-backed-experiment-memory.test.mjs`

### Modified files

- `agents/coder/AGENTS.md`
- `templates/PROJECT_MANIFEST.json`
- `templates/EXPERIMENT_MANIFEST.json`
- `templates/EXPERIMENT_INDEX.md`
- `WORKFLOW.md`
- `docs/architecture/graph-memory.md`
- `tools/workflow-guard-state/execution-state.ts`
- `tools/workflow-guard-experiment-history.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/workflow-guard-stages/execution-stage-signals.ts`
- `tools/workflow-guard-guidance/experiment-review-guidance.ts`
- `skills/planner/experiment-plan/SKILL.md`
- `skills/coder/implement-experiment/SKILL.md`
- `skills/coder/run-experiment/SKILL.md`
- `skills/researcher/experiment-phase/SKILL.md`
- `skills/researcher/innovation-reflection/SKILL.md`
- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`

---

## Task 1: Lock the graph-backed search-loop behavior with failing tests

**Files:**

- Create: `tests/graph-backed-experiment-memory.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/workflow-service.test.mjs`

- [ ] Add failing tests that `experiment` stage can carry a reviewed search envelope instead of only one-shot launch semantics.
- [ ] Add failing tests that `EXPERIMENT_LEDGER.json` remains the runtime source of truth while `EXPERIMENT_MEMORY_PACKET.json` is derived/materialized.
- [ ] Add failing tests that `graph_sync_pending` does not block `analyze`, but stale reflection blocks the next serious `idea` round.
- [ ] Add failing tests that `coder` receives compact packet guidance and does not need live PaperNexus access by default.
- [ ] Add failing tests that only promoted candidates advance the incumbent git branch, while non-promoted candidates are discarded and survive only in ledger/state.

## Task 2: Add durable search-loop contracts

**Files:**

- Create: `templates/EXPERIMENT_SEARCH_SPEC.json`
- Create: `templates/SEARCH_STATE.json`
- Modify: `templates/PROJECT_MANIFEST.json`
- Modify: `templates/EXPERIMENT_MANIFEST.json`
- Modify: `templates/EXPERIMENT_INDEX.md`
- Modify: `tools/workflow-guard-state/execution-state.ts`

- [ ] Add `search_spec_path`, `search_state_path`, and packet pointers to bundle contracts.
- [ ] Add git lineage fields such as `incumbent_branch`, `incumbent_commit`, `last_candidate_branch`, and `last_candidate_commit`.
- [ ] Extend `PROJECT_MANIFEST.json.experiment_memory` with graph packet and sync-status paths.
- [ ] Extend `experiment_search` with session-level fields such as `search_session_id`, `search_spec_path`, `search_state_path`, and `incumbent_experiment_id`.
- [ ] Keep backward compatibility for old projects that only know one-shot experiment launch.

## Task 3: Teach the ledger how to represent search sessions

**Files:**

- Modify: `tools/workflow-guard-experiment-history.ts`
- Modify: `templates/EXPERIMENT_LEDGER.json`
- Modify: `tools/register-workflow-tools.ts`

- [ ] Extend ledger entry normalization/serialization with search-session metadata:
  - `base_commit`
  - `candidate_commit`
  - `promoted_commit`
  - `search_session_id`
  - `candidate_role`
  - `comparison_target`
  - `promotion_decision`
  - `incumbent_basis_experiment_id`
- [ ] Keep `papernexus_sync.status` per entry and make it easy to derive “which runs still need graph sync”.
- [ ] Ensure the ledger summary still computes `best_known_config_ref` correctly for promoted search candidates.

## Task 4: Materialize graph-backed experiment memory packets

**Files:**

- Create: `tools/workflow-guard-state/experiment-memory-graph.ts`
- Create: `tools/workflow-guard-materializers/experiment-memory-packet-materializer.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`

- [ ] Add a workflow-owned materializer that reads:
  - `EXPERIMENT_LEDGER.json`
  - `INNOVATION_REFLECTION.md`
  - relevant PaperNexus packets / graph overlays
  and writes `researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json`.
- [ ] Add a durable sync-status file `researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json`.
- [ ] Add runtime helpers such as:
  - `get_experiment_memory_packet`
  - `materialize_experiment_memory_packet`
  - `reconcile_experiment_graph_memory`
- [ ] Keep this path MCP-first / wrapper-backed for live graph interaction; do not introduce raw REST drift.

## Task 5: Introduce coder-owned bounded search

**Files:**

- Create: `tools/workflow-auto-experiment-search.ts`
- Create: `skills/coder/search-experiment/SKILL.md`
- Modify: `skills/coder/implement-experiment/SKILL.md`
- Modify: `skills/coder/run-experiment/SKILL.md`
- Modify: `skills/researcher/experiment-phase/SKILL.md`

- [ ] Add a `coder` skill that runs a bounded inner loop from approved `EXPERIMENT_SEARCH_SPEC.json`.
- [ ] Make that inner loop git-native: candidate branch/worktree per trial, incumbent branch for accepted history, discard non-promoted branches.
- [ ] Require `coder` to update `SEARCH_STATE.json`, bundle manifest, and ledger after each candidate decision.
- [ ] Allow only envelope-bounded changes:
  - approved hyperparams
  - approved switches
  - approved repair actions
- [ ] Enforce that secondary diagnostics such as gap reduction can guide the next candidate but cannot promote a commit unless the packet explicitly makes them primary.
- [ ] Require immediate escalation back to `researcher` when the candidate would:
  - change metric
  - change dataset
  - change baseline protocol
  - change model semantics beyond the approved innovation cone

## Task 6: Wire graph-backed memory into planning and reflection

**Files:**

- Modify: `skills/planner/experiment-plan/SKILL.md`
- Modify: `skills/researcher/innovation-reflection/SKILL.md`
- Modify: `tools/workflow-guard-guidance/experiment-review-guidance.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`

- [ ] Make `planner` read the experiment-memory packet before writing the next search envelope.
- [ ] Make `innovation-reflection` explicitly consume both raw ledger evidence and distilled packet evidence.
- [ ] Add guidance that repeated under-baseline failures should narrow future envelopes instead of only producing prose summaries.
- [ ] Trigger packet refresh after promoted incumbents or decisive failure clusters.

## Task 7: Update stage guards and documentation

**Files:**

- Modify: `WORKFLOW.md`
- Modify: `docs/architecture/graph-memory.md`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`

- [ ] Document the new local-first / graph-second experiment memory model.
- [ ] Clarify that graph sync is non-blocking for `analyze` but freshness-blocking for later novelty-sensitive ideation.
- [ ] Teach stage guards how to distinguish:
  - missing runtime evidence
  - sync-pending graph memory
  - stale innovation reflection

## Task 8: Verify the whole loop

**Files:**

- Modify: `docs/superpowers/plans/2026-04-10-graph-backed-experiment-memory-coder-search-loop.zh-CN.md`

- [ ] Run the targeted Node test suites for runtime tools, auto-iterator, workflow service, and the new packet/search tests.
- [ ] Run `npm run build`.
- [ ] Update this plan with a short completion note if the implemented design intentionally diverges.

---

## Recommended Delivery Order

如果只做最小可用切片，建议按下面顺序：

1. 先落 `EXPERIMENT_SEARCH_SPEC.json` + `SEARCH_STATE.json`
2. 再把 git ratchet contract 接到 bundle / ledger / skill 文档
3. 再落 `EXPERIMENT_MEMORY_PACKET.json` materializer
4. 然后实现 `/search-experiment`
5. 最后再把 auto-iterator / stage guard / reflection freshness 串起来

这样可以先拿到一个可用的单-track、单-GPU、approved-envelope、git-native search loop，再逐步接上 graph-backed experiment memory。

---

## Success Criteria

实现完成后，系统应该能稳定回答下面这些问题：

1. 当前 `coder` 正在搜索的 innovation cone 是什么，哪些维度被冻结？
2. 当前 incumbent 是谁，它相对 baseline 的保留理由是什么？
3. 最近 5 个 candidate 里，哪些是 runtime failure，哪些是 scientific rollback？
4. 哪些 experiment evidence 已经同步进 graph，哪些还只在 ledger 里？
5. 当前 incumbent 分支上的每一个保留 commit，是否都能被追溯到明确的 promotion reason，而不是“gap 变小”这种弱信号？
6. 下一个 `planner` 在写 envelope 时，是否能自动避开已知 failure pattern？
7. 下一轮 `idea` 是否已经消费了最新的 graph-backed innovation reflection？

如果这七个问题还能靠 durable state 被直接回答，就说明 local runtime、git ratchet、graph memory 和 coder search loop 已经真正接上了。
