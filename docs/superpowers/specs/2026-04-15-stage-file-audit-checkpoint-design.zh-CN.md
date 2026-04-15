# Stage File Audit Checkpoint 设计

## 目标

为 workflow control plane 增加一种稳定的、可恢复的 `audit checkpoint` 能力：

1. 在指定的 workflow 位置触发审核。
2. 由指定 `auditor agent` 审核当前阶段中的某个特定文件。
3. 审核要求完全由 prompt / policy 控制，而不是写死在代码里。
4. 若审核不通过，自动把修订任务发回被审核 agent。
5. 直到文件满足要求、达到重试上限、或升级为人工/编排器决策为止。

这不是“再加一个 reviewer prompt”。
稳定实现应把它做成 control-plane 级 checkpoint，具备 durable state、fingerprint 去重、可恢复轮次、可追踪 handoff、以及可验证的失败语义。

---

## 为什么不做最小实现

最小实现通常会长成下面这样：

- 在某个命令末尾临时调用 reviewer
- reviewer 读文件后给一段自然语言结论
- 失败时临时拼一条消息回给 writer / coder

这种做法短期可用，但长期不稳定：

- 没有 durable state，runtime 重启后会丢轮次
- 无法区分“文件没变”与“审核还没跑”
- 无法避免同一个文件重复审核
- 无法和现有 `auto_iterator` / `handoff` / `artifact receipt` 统一
- 很难解释“现在为什么 blocked”

所以稳定实现应该复用现有的：

- `workflow-guard` stage gate
- `review-round` / `artifact receipt`
- `dispatchWorkflowTaskToAgent(...)`
- `handoff` / `mailbox`
- `register-workflow-service.ts` 里的自动轮询与恢复模式

---

## 稳定版架构结论

建议把它设计成三层：

1. `checkpoint policy`
   定义“何时审、审谁、审哪个文件、用什么 prompt、失败后发给谁修”。
2. `audit runtime state`
   记录当前轮次、文件指纹、审核结果、是否已回修、是否需要升级。
3. `service orchestration`
   在 `auto_iterator` / task completion hook 上决定是否启动审核、轮询审核结果、派发修订消息、等待文件变化后重审。

简化说：

`policy` 决定应该做什么，`state` 决定做到哪一步了，`service` 决定下一步怎么推进。

---

## Hook 化结论

可以做成 `hooks` 设计，但稳定实现不建议做成“任意函数 callback”。

更合适的是：

- **声明式 workflow hooks**
- **hook point 固定枚举**
- **hook payload 固定结构**
- **hook executor 由 control plane 统一驱动**

换句话说：

- `checkpoint` 不是和 `hook` 对立的概念
- 最稳定的做法是把 `checkpoint` 实现成一种 `audit hook instance`

推荐心智模型：

- `hook point`
  表示挂载位置，例如某个产出节点或 handoff 节点。
- `hook`
  表示挂在这个位置上的一个具体审核规则。
- `hook run`
  表示某次实际执行。

所以系统可以自然支持：

- 一个节点挂多个 hook
- 同一个 hook point 上的不同审核目标
- 同一份文件由不同 auditor 从不同要求独立审核

---

## Hook 点模型

建议把 hook 点收敛成几个稳定枚举，而不是任意字符串：

- `artifact_materialized`
  某个关键产物刚生成。
- `before_stage_handoff`
  阶段准备交接给下一个 owner 前。
- `after_stage_handoff`
  handoff 已经建立，但尚未激活下一阶段自动推进。
- `before_task_complete`
  team/task graph 中 task 完成前。
- `before_stage_complete`
  阶段被标记 complete 前。
- `before_handoff_activation`
  handoff intent 已存在，但 manifest owner/stage 尚未真正切换。
- `after_handoff_activation`
  handoff 已激活，可做非阻塞 post-handoff hook。

### 为什么不建议“任意函数钩子”

因为那样会带来：

- 难恢复
- 难追踪
- 难测试
- hook 顺序不稳定
- side effect 边界不清晰

而固定 hook point 可以直接接到现有：

- `auto_iterator`
- `task completion hooks`
- `handoff activation / delivery`

---

## 当前代码的稳定接入难点

如果直接往当前代码里“找个地方插 hook”，很容易变成新的复制层。
现状里最需要先收敛的点有四个：

### 1. `register-workflow-service.ts` 已经承载了多套 feature-specific review loop

当前这里已经有：

- `maybeAdvanceAutoCodeReviewForProject(...)`
- `maybeAdvanceAutoGateReviewForProject(...)`
- `maybeAdvanceAutoModeDiscussionForProject(...)`
- `maybeLaunchAutoStageForProject(...)`

这些逻辑各自可用，但共同问题是：

- 每套都有自己一份 launch / poll / parse / aggregate / refresh 逻辑
- 新增 hook 如果继续照这个模式写，会继续膨胀这个文件

### 2. `auto_iterator` 还没有“hook result”这个一等概念

当前 `tools/workflow-guard-runtime/auto-iterator.ts` 只稳定输出：

- `gateBlocking`
- `missingStageSignals`
- `recommendedActions`

如果把 hook 结果强行塞进 `blockingReason` 或普通 `background` action，会让控制面语义越来越模糊。

### 3. `stage-preflight` 只返回 contract 名称，不返回 hookable event

`maybePrepareWorkflowStageContracts(...)` 现在只返回：

- `materializedContracts: string[]`
- `errors`

这对日志够用，但对 `artifact_materialized` hook 不够。
hook 需要知道：

- 哪个 contract 触发了事件
- 具体有哪些 artifact 路径
- 这些 artifact 是本轮刚创建、更新，还是 reconcile 产生的

### 4. task 与 handoff 都没有统一 hook gateway

当前：

- `tools/workflow-team/task-hooks.ts`
  里只有 deterministic verification，再决定 complete / needs_repair
- `tools/workflow-handoff/handoff-activation.ts`
  里会直接把 owner/stage 写进 manifest，然后激活 handoff

也就是说：

- task complete 前没有统一 hook 插槽
- handoff 激活前没有统一 hook 插槽

如果不先抽一层统一 gateway，hook 很快会在多个模块里各写一套。

---

## 推荐的重构方向

最稳定的接法不是“把 hook 逻辑塞进现有函数”，而是：

1. 把 **hook contract / state / executor** 抽成独立层
2. 让现有 `auto_iterator` / `service` / `task-hooks` / `handoff-activation`
   只负责在稳定边界调用它

### 重构原则

- 不要在每个 materializer 里单独跑 hook
- 不要在每个 reviewer loop 里复制一份 hook 状态机
- 不要让 hook 直接改 manifest owner/stage
- hook 结果只能通过统一 executor 反馈给 control plane

---

## 目标代码结构

建议新增一层专门的 hook control plane：

### 新增模块建议

- `tools/workflow-hooks/contracts.ts`
  定义 `HookPolicy`、`HookPoint`、`HookRunState`、`HookAggregateVerdict`
- `tools/workflow-hooks/state.ts`
  负责 runtime store 读写、normalize、serialize
- `tools/workflow-hooks/point-context.ts`
  负责把当前运行点转换成统一的 `HookPointContext`
- `tools/workflow-hooks/executor.ts`
  负责：
  - 过滤命中的 hooks
  - 排序 / 按 `parallel_group` 聚合
  - 启动 / 轮询 hook run
  - 生成 aggregate revision packet
  - 产出 aggregate verdict
- `tools/workflow-hooks/file-audit-runner.ts`
  负责 `file_audit` 这种 hook type 的 packet、prompt、parse、report
- `tools/workflow-hooks/revision-dispatch.ts`
  负责把多个 hook 的修订要求聚合成一条 dispatch

### 现有模块建议保留职责

- `tools/workflow-guard-runtime/auto-iterator.ts`
  只负责 stage gate 与 action 计算，不直接理解 file audit 细节
- `tools/register-workflow-service.ts`
  只负责周期性推进和调用 hook executor
- `tools/workflow-team/task-hooks.ts`
  只负责 task 生命周期
- `tools/workflow-handoff/handoff-activation.ts`
  只负责 handoff claim / activate

这样 hook 才是“横切层”，不是“复制到每个子系统里的 feature”。

---

## 建议先抽的公共层

当前最值得先抽出来的是 `register-workflow-service.ts` 里的 reviewer run lifecycle。

### 现有重复模式

`pollGateReviewAttempts(...)`、`pollCodeReviewAttempts(...)`、`pollAutoModeDiscussionAttempts(...)`
已经体现出一套重复骨架：

1. 找 announce result
2. `waitForRun(...)`
3. 读 session messages
4. parse reviewer output
5. 写 announce event
6. 更新 attempt state

稳定做法是先把这套骨架抽成通用 runner，例如：

- `tools/workflow-hooks/runtime-review-loop.ts`

提供：

- `launchHookReviewerRun(...)`
- `pollHookReviewerAttempts(...)`
- `finalizeHookReviewerAttempt(...)`

这样 file audit hooks 不会再在 service 里复制第三套、第四套轮询器。

### 第二个值得先抽的公共层

当前回修派发散落在 feature-specific 逻辑里。

建议抽出：

- `dispatchAggregateHookRevision(...)`

统一处理：

- 目标 session 选择
- aggregate revision packet 引用
- mailbox/handoff 兼容
- idempotency key

---

## 最稳定的 Hook 插入位置

下面这些位置是我认为最稳定的边界。

### 1. `auto_iterator` 内的 `artifact_materialized`

**位置：**

- `tools/workflow-guard-runtime/auto-iterator.ts`
- `runWorkflowAutoIterator(...)`
- 在 `maybePrepareWorkflowStageContracts(...)` 之后、stage readiness / recommended actions 之前

**为什么这里最稳：**

- 所有 stage 预备物化都经过这里
- 还没有进入 handoff / launch
- 可以阻止“刚物化关键产物，却还没审就直接推进”

**需要的重构：**

把 `maybePrepareWorkflowStageContracts(...)` 的返回值从：

```ts
{
  manifest,
  materializedContracts: string[],
  errors: ...
}
```

扩展成：

```ts
{
  manifest,
  materializedContracts: string[],
  materializedArtifacts: Array<{
    contract: string;
    artifactPath: string | null;
    fingerprint: string | null;
    action: "created" | "updated" | "reconciled";
  }>,
  emittedHookEvents: Array<{
    hookPoint: "artifact_materialized";
    contract: string;
    artifactPath: string | null;
  }>,
  errors: ...
}
```

然后 `auto_iterator` 把这些 event 交给：

- `evaluateWorkflowHooksForPoint({ hookPoint: "artifact_materialized", ... })`

### 2. service 主循环里的 `before_stage_handoff`

**位置：**

- `tools/register-workflow-service.ts`
- 在 `maybeAdvanceAutoModeDiscussionForProject(...)` 之后
- 在 `maybeLaunchAutoStageForProject(...)` 之前

也就是当前这段链路之间：

- `auto code review`
- `auto gate review`
- `auto mode discussion`
- `auto stage launch`

**为什么这里最稳：**

- 所有自动 handoff 最终都从这里发出
- 这时已经拿到了最新 `autoIteratorResult`
- 可以用 hook 结果直接拦住 `drive_stage`

**建议做法：**

新增：

- `maybeAdvanceWorkflowHookPointForProject({ hookPoint: "before_stage_handoff", ... })`

并让它返回：

- `aggregateVerdict`
- `recommendedActionOverride`
- `revisionDispatch`

如果 verdict 不是 `pass`，就不要进入 `maybeLaunchAutoStageForProject(...)`。

### 3. handoff 激活路径里的 `before_handoff_activation`

**位置：**

- `tools/workflow-handoff/handoff-activation.ts`
- `claimAndActivateWorkflowHandoffForAgent(...)`
- 在真正写入：
  - `manifest.current_stage`
  - `manifest.owner_agent`
  之前

**为什么这里最稳：**

- 这是“owner/stage 真正切换”的最后闸门
- 可以兜底防止绕过 service 的 handoff 激活

**建议语义：**

- `before_stage_handoff`
  是 service 级主 gate
- `before_handoff_activation`
  是 runtime 级最终兜底 gate

前者是主路径，后者是 final safety net。

### 4. handoff 激活后的 `after_handoff_activation`

**位置：**

- 同样在 `claimAndActivateWorkflowHandoffForAgent(...)`
- 在 `activateWorkflowHandoffIntent(...)` 成功之后

**适合做什么：**

- 非阻塞审计
- 记录
- dashboard note
- low-risk notification

**不适合做什么：**

- 不适合做会回滚 owner/stage 的 blocking hook

### 5. task graph 里的 `before_task_complete`

**位置：**

- `tools/workflow-team/task-hooks.ts`
- `completeWorkflowTaskAndContinue(...)`
- 在 `verifyWorkflowTaskCompletion(...)` 已通过之后
- 在 `completeWorkflowTask(...)` 之前

**为什么放这里：**

- deterministic verification 先跑，hook 再做语义审计
- 避免基础 readiness 都没过就先起 auditor

**建议行为：**

- 内建 verification 失败：直接 `needs_repair`
- 内建 verification 通过但 hook 失败：
  - 标记 `needs_repair`
  - 写 aggregate revision packet
  - 把修订任务发回当前 task owner

---

## 不建议的 Hook 位置

为了稳定，下面这些位置不建议直接挂 hook：

### 1. 每个 materializer 内部

例如：

- `materializeSurveyReviewState(...)`
- `materializePaperStoryState(...)`

原因：

- 会让 hook 跟业务 materializer 强耦合
- 很难做统一排序、聚合、恢复

正确做法是：

- materializer 只产出 event
- hook executor 在 `stage-preflight` 边界统一消费

### 2. 每次文件写入之后

不要把 hook 做成“文件系统 watcher”。

原因：

- 太噪
- 语义不稳定
- 无法区分关键产物与临时文件

### 3. prompt hooks 或 UI hooks

`tools/register-workflow-hooks.ts` 当前主要是 prompt/context 注入层。

不建议把 workflow audit hooks 直接混进去。

原因：

- 那是 agent prompt surface
- 不是 durable control-plane gate

这两种 hook 名字相似，但层级不同。

---

## 推荐的重构顺序

为了降低风险，建议按下面顺序改：

### Step 1: 先抽公共 runner，不碰现有 gate 语义

- 抽出 reviewer launch/poll/announce 通用层
- 抽出 aggregate revision dispatch 通用层

这样不会立刻改变现有控制行为，但为 hook 铺底座。

### Step 2: 给 `stage-preflight` 增加 event 输出

- 增加 `materializedArtifacts`
- 增加 `emittedHookEvents`

这一步只扩返回值，不改现有行为。

### Step 3: 新增 hook control plane，但先只接 file audit

- `workflow_hooks.audit_hooks[]`
- runtime state
- hook executor

先不要把现有 `CODE-REVIEW` / `GATE-5` 迁移进去。

### Step 4: 在 service 主循环接入 `before_stage_handoff`

让它成为第一批真正生效的 hook point。

这是收益最高、风险最低的位置。

### Step 5: 在 task/handoff 上补兜底 hook

- `before_task_complete`
- `before_handoff_activation`
- `after_handoff_activation`

### Step 6: 评估是否迁移现有 feature-specific review

当 generic hook runner 稳定后，再考虑把：

- `auto code review`
- `auto gate review`

迁成 built-in hooks。

不建议一开始就做大迁移。

---

## 文档级结论

最稳定的重构路线不是“新增一个 hooks 字段然后四处 if 判断”，而是：

1. 把现有 reviewer loop 抽成公共 runtime runner
2. 把 `stage-preflight` 升级为 event source
3. 把 `service`、`task-hooks`、`handoff-activation` 变成三个稳定 hook gateway
4. 让 hook executor 成为唯一理解 hook policy / state / aggregation / revision dispatch 的地方

这样 hook 才能真正“接进去”，而不是“贴上去”。

---

## 接入位置

为了稳定，v1 不支持“任意代码点注入回调”。
v1 只支持语义化 checkpoint 位置，这样才能和现有 control plane 对齐。

建议支持两类位置：

### 1. stage-level checkpoint

由 `auto_iterator` 在阶段推进前判断：

- `before_stage_handoff`
  在当前 owner 即将把阶段交给下一个 owner 前触发。
- `before_stage_complete`
  在阶段被宣布 complete 前触发。

这是最稳定的默认模式，适合大多数场景。

### 2. task-level checkpoint

由 `workflow-team/task-hooks.ts` 或 task completion path 触发：

- `before_task_complete`
  某个 task 标记完成前必须先过审核。

这适合 team/task graph 模式里“某一份文件必须先被审过，task 才能关闭”的场景。

不建议一开始支持更细的“任意函数调用点”。
那会把 control plane 退化成 scattered callback system，稳定性会明显变差。

---

## 配置合同

建议把 hook 配置放进 `PROJECT_MANIFEST.json.workflow_hooks`，其中 `audit` 是一种 hook type。

这样更适合以后扩展：

- audit hooks
- materialization hooks
- notification hooks
- human-approval hooks

同时保留一个兼容别名：

- `workflow_audit.checkpoints[]`

可以在 materializer 里转译成：

- `workflow_hooks.audit_hooks[]`

建议新增：

```json
{
  "workflow_hooks": {
    "enabled": true,
    "audit_hooks": [
      {
        "hook_id": "write-main-tex-claim-audit",
        "hook_type": "file_audit",
        "enabled": true,
        "stage": "review",
        "hook_point": "before_stage_handoff",
        "order": 100,
        "parallel_group": "review-handoff-audits",
        "target_role": "academic_writer",
        "auditor_role": "reviewer",
        "file_path": "academic_writer/paper/main.tex",
        "requirement_prompt": "检查 main.tex 是否只保留有证据支撑的论断，禁止新增未在 CLAIM_EVIDENCE_MATRIX.md 中出现的强结论；若存在问题，列出必须修改的段落或 section。",
        "supporting_artifacts": [
          "analyzer/CLAIM_EVIDENCE_MATRIX.md",
          "reviewer/REVIEW_REPORT.md"
        ],
        "blocking_mode": "block_stage",
        "max_rounds": 3,
        "max_unchanged_rounds": 2,
        "revise_owner_role": "academic_writer",
        "revise_command": "修复文件后重新运行 research_workflow.auto_iterator_tick",
        "report_dir": "reviewer/file-audits/write-main-tex-claim-audit"
      },
      {
        "hook_id": "write-main-tex-citation-audit",
        "hook_type": "file_audit",
        "enabled": true,
        "stage": "review",
        "hook_point": "before_stage_handoff",
        "order": 110,
        "parallel_group": "review-handoff-audits",
        "target_role": "academic_writer",
        "auditor_role": "cross-reviewer",
        "file_path": "academic_writer/paper/main.tex",
        "requirement_prompt": "检查 main.tex 中所有关键比较和强结论是否有 citation 支撑，禁止只靠作者口吻暗示 superiority。",
        "supporting_artifacts": [
          "reviewer/CITATION_VERIFICATION.md",
          "reviewer/REVIEW_REPORT.md"
        ],
        "blocking_mode": "block_stage",
        "max_rounds": 3,
        "max_unchanged_rounds": 2,
        "revise_owner_role": "academic_writer",
        "revise_command": "修复引用与表述问题后重新运行 research_workflow.auto_iterator_tick",
        "report_dir": "reviewer/file-audits/write-main-tex-citation-audit"
      }
    ]
  }
}
```

### 字段说明

- `hook_id`
  稳定主键，用于去重、恢复、trace、dashboard。
- `hook_type`
  当前建议先支持 `file_audit`。
- `stage`
  该 checkpoint 属于哪个 workflow stage。
- `hook_point`
  挂载点，只允许受控枚举值。
- `order`
  同一个 hook point 上的稳定排序键。
- `parallel_group`
  允许多个 hook 在同一组里并发执行，再统一聚合结果。
- `target_role`
  被审核文件的责任 agent。
- `auditor_role`
  负责审核的 agent，通常是 `reviewer` / `cross-reviewer` / `analyzer`。
- `file_path`
  被审核文件的相对路径。
- `requirement_prompt`
  用户真正想控制的审核要求。
- `supporting_artifacts`
  审核时允许阅读的附加上下文，避免 auditor 漫游整个项目。
- `blocking_mode`
  `block_stage | warn_only | rollback_stage`
- `max_rounds`
  最大审核轮次。
- `max_unchanged_rounds`
  连续发现“文件未变化但仍请求复审”后触发升级。
- `revise_owner_role`
  审核失败后消息发给谁。
- `revise_command`
  回修消息里的明确下一步。
- `report_dir`
  每轮审核产物落盘目录。

---

## 多 Hook 聚合语义

既然一个产出节点或 handoff 节点允许挂多个 hook，就必须先定义聚合规则。

建议：

### 1. 执行顺序

- 先按 `hook_point`
- 再按 `stage`
- 再按 `order`
- 同 `parallel_group` 内允许并发

### 2. 聚合结果

每个 hook 独立产出：

- `pass`
- `revise`
- `block`

节点级聚合规则建议为：

- 任一 `block` => 节点结果 `block`
- 无 `block` 但任一 `revise` => 节点结果 `revise`
- 全部 `pass` => 节点结果 `pass`

### 3. 回修派发

不要给 target agent 发 N 条离散回修消息。

更稳定的做法是：

- 每个 hook 保留自己的 audit report
- control plane 再生成一个 `aggregate revision packet`
- 只向 target agent 派发一条聚合后的修订任务

这样可以避免：

- 多个 auditor 同时轰炸同一个 agent
- 相互矛盾的回修指令
- session transcript 污染

### 4. 支持多 target 吗

v1 不建议一个 hook 同时指向多个 target role。

更稳定的设计是：

- 一个 hook 只对应一个 `target_role + file_path`
- 如果同一节点要审多个文件，就声明多个 hook

---

## Hook Executor 设计

建议新增统一执行器，而不是让各处自己调 reviewer：

- `evaluateWorkflowHooksForPoint(...)`

输入：

- `projectRoot`
- `projectId`
- `stage`
- `hookPoint`
- `ownerRole`
- `handoffContext | artifactContext | taskContext`

输出：

- `hookRuns`
- `aggregateVerdict`
- `blockingReason`
- `revisionDispatchNeeded`

这个 executor 内部负责：

1. 过滤当前命中的 hooks
2. 为每个 hook 建 packet / fingerprint
3. 启动或轮询 hook run
4. 聚合多个 hook 结果
5. 生成 aggregate revision packet
6. 决定是放行、阻塞、还是升级

这样 `auto_iterator` 和 `task hooks` 都只需要调用统一入口。

---

## Runtime State 合同

高频变化的轮次状态不建议直接塞进 manifest。
建议单独存到：

- `.openclaw-research/file-audit-state.json`

原因：

- 轮询更新频繁
- 避免污染 manifest
- 更容易原子更新
- 更接近现有 `gate-review-state.json` / `code-review-state.json` 模式

建议结构：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-15T10:00:00.000Z",
  "hookPoints": {
    "before_stage_handoff": {
      "review": {
        "aggregateStatus": "idle | auditing | revise_requested | passed | failed | escalated",
        "aggregateVerdict": "pass | revise | block | null",
        "aggregateRevisionPacketPath": "reviewer/file-audits/review-before-stage-handoff/AGGREGATE_REVISION_PACKET.md",
        "updatedAt": "..."
      }
    }
  },
  "hooks": {
    "write-main-tex-claim-audit": {
      "hookId": "write-main-tex-claim-audit",
      "stage": "review",
      "hookPoint": "before_stage_handoff",
      "status": "idle | auditing | revise_requested | passed | failed | escalated",
      "roundsStarted": 1,
      "activeRound": {
        "roundId": "uuid",
        "status": "pending | completed | failed",
        "auditorRole": "reviewer",
        "targetRole": "academic_writer",
        "filePath": "academic_writer/paper/main.tex",
        "fileFingerprint": "sha1:...",
        "packetPath": "reviewer/file-audits/.../AUDIT_PACKET.md",
        "packetJsonPath": "reviewer/file-audits/.../AUDIT_PACKET.json",
        "reportPath": "reviewer/file-audits/.../AUDIT_REPORT.json",
        "runId": "runtime-run-id",
        "sessionKey": "agent:reviewer:...",
        "launchedAt": "...",
        "completedAt": null
      },
      "lastPassedFingerprint": null,
      "lastReviewedFingerprint": "sha1:...",
      "lastVerdict": "pass | revise | block | null",
      "lastRevisionDispatch": {
        "runId": "dispatch-run-id",
        "sessionKey": "agent:academic_writer:...",
        "dispatchedAt": "..."
      },
      "consecutiveUnchangedRounds": 0,
      "blockedReason": null,
      "escalationReason": null,
      "updatedAt": "..."
    }
  }
}
```

关键点：

- `lastPassedFingerprint`
  用于判断“当前文件内容是否已经被审核通过”。
- `lastReviewedFingerprint`
  用于避免同一内容无限重复审。
- `consecutiveUnchangedRounds`
  用于识别“没改文件还一直重跑”的坏循环。
- `hookPoints.*.aggregateRevisionPacketPath`
  用于多 hook 场景下给 target agent 的统一修订入口。

---

## Packet 与 Report 产物

每轮审核必须物化 packet 和 report，建议落到：

- `reviewer/file-audits/<checkpoint_id>/round-<n>/AUDIT_PACKET.md`
- `reviewer/file-audits/<checkpoint_id>/round-<n>/AUDIT_PACKET.json`
- `reviewer/file-audits/<checkpoint_id>/round-<n>/AUDIT_REPORT.json`
- `reviewer/file-audits/<checkpoint_id>/round-<n>/AUDIT_REPORT.md`

这样做的好处：

- 审核不是黑盒
- dashboard / 调试可以直接看证据
- 失败后回修 agent 也能读到上一轮的结构化问题

### Packet 内容建议

- project id / root
- stage / trigger / checkpoint id
- target role / auditor role
- `file_path`
- `file_fingerprint`
- `requirement_prompt`
- `supporting_artifacts`
- 文件内容全文或受控截断
- 明确“仅审这个文件，不扩 scope”

### 审核结果 JSON

要求 auditor 返回严格 JSON：

```json
{
  "verdict": "pass | revise | block",
  "summary": "一段简短结论",
  "violations": [
    {
      "rule": "unsupported_claim",
      "severity": "high",
      "location": "section 3.2",
      "message": "该结论未在 supporting artifacts 中得到支撑"
    }
  ],
  "requiredFixes": [
    "删除第 3.2 节中超出 CLAIM_EVIDENCE_MATRIX.md 的结论",
    "把 related work 里的强比较改成受限表述"
  ],
  "reviewedArtifacts": [
    "academic_writer/paper/main.tex",
    "analyzer/CLAIM_EVIDENCE_MATRIX.md"
  ],
  "confidence": 0.89
}
```

解析失败一律按 `block` 处理。

---

## 审核失败后的修订闭环

这是这个模块最核心的稳定性点。

失败后不能只记状态，必须真正把回修任务送回责任 agent。

建议流程：

1. auditor 返回 `revise` 或 `block`
2. control plane 写入 audit report
3. 生成 `artifact receipt`
4. 使用 `dispatchWorkflowTaskToAgent(...)` 向 `revise_owner_role` 发送修订消息
5. 消息里引用：
   - audit report 路径
   - 原文件路径
   - 必修项
   - 明确下一步命令
6. checkpoint 状态转为 `revise_requested`
7. `auto_iterator` 在看到文件 fingerprint 变化前持续保持 blocked
8. 文件变化后自动开启下一轮 audit

### 为什么用 dispatch，而不是自己写 mailbox

因为稳定实现应该复用现有 session 选择和 active owner 复用逻辑：

- `dispatchWorkflowTaskToAgent(...)`
- `deriveAgentSessionKeyForRole(...)`
- `handoffWorkflowTaskToAgent(...)`

这样能自动处理：

- 已激活 owner session 复用
- mailbox ack
- session fallback
- trace / announce

### revise message 建议内容

建议统一模板：

```text
Workflow audit revision request.
Checkpoint: write-main-tex-claim-audit
Stage: review
Target file: academic_writer/paper/main.tex
Audit report: reviewer/file-audits/write-main-tex-claim-audit/round-2/AUDIT_REPORT.md

Required fixes:
- ...
- ...

Revise only the target file unless the audit report explicitly names supporting artifacts.
After updating the file, rerun research_workflow.auto_iterator_tick.
```

---

## Auto Iterator 与 Handoff 集成

稳定实现里，`auto_iterator` 必须知道 audit checkpoint 的存在。

### 规则

当当前 stage 的某个 `hook_point=before_stage_handoff` 命中 enabled hooks，且满足以下任一条件时，stage 不得继续 handoff：

- 当前文件 fingerprint 从未通过该 checkpoint
- 当前有正在进行中的 audit round
- 上一轮 verdict 为 `revise` / `block`，且文件 fingerprint 尚未变化
- checkpoint 已进入 `escalated`

### 推荐新增 action kind

当前 `AutoIteratorAction.kind` 只有：

- `drive_stage`
- `background`
- `wait_human`
- `switch_project`

建议新增：

- `audit_checkpoint`
- `revise_checkpoint`

这样 dashboard / status / service 都能明确表达现在不是普通 blocked，而是“正在等审核”或“正在等回修”。

### 行为

- `audit_checkpoint`
  说明系统正在等待 auditor 完成该文件审核。
- `revise_checkpoint`
  说明 auditor 已返回问题，正在等待 target agent 修文件。

同理，handoff 路径也可以支持：

- `before_stage_handoff`
  在 handoff intent 激活前跑 hooks
- `after_stage_handoff`
  handoff 建立后做非阻塞 hook，例如记录、通知、低风险审计

---

## Service Orchestration

建议新增两个平级服务入口：

- `maybeAdvanceWorkflowHookPointForProject(...)`
- `maybeAdvanceFileAuditHookForProject(...)`

其中：

- `maybeAdvanceWorkflowHookPointForProject(...)`
  负责某个节点上多个 hooks 的聚合调度。
- `maybeAdvanceFileAuditHookForProject(...)`
  负责单个 `file_audit` hook 的执行细节。

它们共同负责：

1. 从 manifest 解析适用于当前 stage/trigger 的 checkpoint
2. 物化 packet
3. 若无 active round，则启动 auditor nested run
4. 若有 active round，则轮询 run 结果
5. 审核通过则标记 `passed`
6. 审核失败则写 report、产 receipt、dispatch revise message
7. 若文件未变化且超过 `max_unchanged_rounds`，升级为 `escalated`
8. 若总轮次超过 `max_rounds`，升级为 `escalated`

### 升级策略

`escalated` 时建议：

- 默认 handoff 给 `orchestrator`
- `blocking_mode=rollback_stage` 时可建议回退 stage
- 保留 `failureKind = verification_failed | manual_recovery`

---

## 文件指纹策略

稳定实现必须引入 file fingerprint。

建议：

- 使用目标文件内容计算 `sha1`
- packet 中持久化该 fingerprint
- report 中回写该 fingerprint
- revise loop 用它判断文件是否真的改过

为什么不用 mtime：

- mtime 会受无意义写入影响
- 多机/同步目录下不稳定
- 无法判断内容是否相同

---

## 失败语义

建议明确区分：

- `pass`
  文件满足要求，可以继续。
- `revise`
  可修复，应该派回 target agent。
- `block`
  不应直接让 target agent在当前阶段继续，需要升级或回退。
- `escalated`
  系统自动流程到此为止，等待 orchestrator / human。

这样能避免把所有失败都压成一个 `blocked`。

---

## 建议新增文件

### 新增模块

- `tools/workflow-hooks/contracts.ts`
  hook policy / point / run / aggregate 的类型合同。
- `tools/workflow-hooks/state.ts`
  hook runtime store 的 normalize / serialize / read / write。
- `tools/workflow-hooks/point-context.ts`
  把 stage/task/handoff/materialization 边界转换成统一 context。
- `tools/workflow-hooks/executor.ts`
  hook point 过滤、排序、聚合、aggregate revision packet 生成。
- `tools/workflow-hooks/runtime-review-loop.ts`
  reviewer launch / poll / parse / announce 的通用运行时骨架。
- `tools/workflow-hooks/file-audit-runner.ts`
  file audit 的 packet / prompt / parser / fingerprint / report 逻辑。
- `tools/workflow-hooks/revision-dispatch.ts`
  聚合修订任务的 dispatch 适配层。

### 修改模块

- `tools/workflow-guard.ts`
  导出类型、summary、state helper。
- `tools/workflow-guard-runtime/auto-iterator.ts`
  接收 stage-preflight hook event，并把 hook verdict 并入 gate decision。
- `tools/workflow-guard-runtime/stage-preflight.ts`
  从“只返回 materializedContracts”升级为“返回 hookable materializedArtifacts / emittedHookEvents”。
- `tools/register-workflow-service.ts`
  增加 `maybeAdvanceWorkflowHookPointForProject(...)` 与 `maybeAdvanceFileAuditHookForProject(...)`。
- `tools/workflow-team/task-hooks.ts`
  在 deterministic verification 通过后增加 `before_task_complete` hook gateway。
- `tools/workflow-handoff/handoff-activation.ts`
  在 owner/stage 真正切换前后增加 `before_handoff_activation` / `after_handoff_activation` gateway。
- `tools/register-workflow-tools.ts`
  暴露 runtime tool：
  - `get_file_audit_state`
  - `set_file_audit_policy`
  - `materialize_file_audit_packet`
  - `ack_file_audit_revision`（可选）

---

## 测试切分

### 1. 状态合同测试

- `tests/workflow-file-audit-state.test.mjs`

覆盖：

- normalize / serialize
- 默认路径
- 枚举值校正
- checkpoint id 去重

### 2. packet / parser 测试

- `tests/workflow-file-audit.test.mjs`

覆盖：

- packet 物化
- fingerprint 稳定性
- prompt 组装
- JSON parse 成功 / 失败分支

### 3. service loop 测试

- `tests/workflow-service.test.mjs`

新增场景：

- 首次触发 hook point 时启动多个 auditor run
- 多个 hook 全部 `pass` 时解除阻塞
- 某个 hook `revise` 时生成 aggregate revision packet 并只派发一条修订消息
- 任一 hook `block` 时节点级结果 `block`
- 文件未变化时保持 `revise_requested`
- 文件变化后只重跑受影响 hook
- 达到 `max_rounds` / `max_unchanged_rounds` 后 `escalated`

### 4. runtime tool 测试

- `tests/workflow-runtime-tools.test.mjs`

覆盖：

- `set_file_audit_policy`
- `get_file_audit_state`
- packet/report 路径输出

### 5. auto iterator 测试

- `tests/auto-iterator.test.mjs`

覆盖：

- checkpoint 待审时 `recommendedActions` 包含 `audit_checkpoint`
- checkpoint 待回修时 `recommendedActions` 包含 `revise_checkpoint`
- pass 后恢复正常 `drive_stage`

---

## 分阶段实现建议

### Phase 1

- state contract
- packet / report materialization
- prompt / parser

### Phase 2

- service loop
- revise dispatch
- fingerprint-based re-audit

### Phase 3

- auto_iterator gate integration
- runtime tool integration
- dashboard 可见性

### Phase 4

- task-level checkpoint hook
- rollback / escalation policy refinement

---

## 最终建议

如果目标是“稳定实现”，最合适的产品形态不是单次审核命令，而是：

`manifest-backed workflow hooks + per-hook file-fingerprint runtime state + hook-point aggregation + service-driven audit/revise loop + auto-iterator/handoff gate`

这样它才会真正像现有 workflow 系统的一部分，而不是 reviewer 旁边再挂一个临时脚本。
