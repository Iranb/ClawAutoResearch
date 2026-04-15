# Workflow Hooks

这页解释的是：为什么控制平面现在把“审核 / 修订 / 节点级约束”收敛成一层显式的 `workflow hooks`，以及它在代码里到底怎样工作。

它不是 prompt hook，也不是 UI hook。
这里说的 hook 是 **workflow control plane 的 durable hook**:

- 配置存在 `PROJECT_MANIFEST.json`
- 运行态存在 `.openclaw-research/`
- 结果会真正阻塞或放行 stage / handoff / task closeout

## 1. 为什么要引入 hooks

在没有 hook 层时，系统里其实已经有几种“类似 hook 的东西”：

- `auto code review`
- `auto gate review`
- `auto mode discussion`
- task completion verification
- handoff activation 前的 mailbox / claim / queue 条件

它们分别解决了局部问题，但共同缺点是：

- 都长在 feature-specific 逻辑里
- reviewer launch / poll / parse / aggregate 逻辑重复
- 很难在任意关键节点挂多个审核器
- 很难统一表达“当前是因为哪个审核规则被挡住了”

`workflow hooks` 的目标是把这些“节点级审核 / 回修 / 放行”能力统一起来。

## 2. 先分清楚两种 hook

仓库里已经有一个 [`tools/register-workflow-hooks.ts`](../../tools/register-workflow-hooks.ts)，但那主要负责：

- prompt injection
- tool preflight
- mailbox auto-ack
- workflow agent prompt surface

这页说的 `workflow hooks` 不是那层。

两者区别：

| 维度 | prompt/tool hooks | workflow hooks |
| --- | --- | --- |
| 主要位置 | `register-workflow-hooks.ts` | `tools/workflow-hooks/` |
| 主要目标 | prompt/tool surface 整理 | stage/task/handoff gate |
| 是否 durable | 通常不是事实源 | 是 durable state 的一部分 |
| 是否会阻塞流程 | 很少直接阻塞 | 可以阻塞 handoff / task complete |
| 输出 | prompt/context/tool guard | packet/report/revision dispatch |

## 3. 核心术语

### 3.1 `hook point`

`hook point` 是挂载位置，也就是“什么时候跑 hook”。

当前设计里收敛成固定枚举，而不是任意 callback:

- `artifact_materialized`
- `before_stage_handoff`
- `after_stage_handoff`
- `before_task_complete`
- `before_stage_complete`
- `before_handoff_activation`
- `after_handoff_activation`

### 3.2 `hook`

`hook` 是挂在某个节点上的一条规则。
当前已落地的 hook type 是：

- `file_audit`

也就是说，当前系统最稳定支持的是：

- 在某个节点
- 让某个 auditor
- 审某个特定文件
- 用固定 requirement prompt 判断 `pass / revise / block`

### 3.3 `hook run`

`hook run` 是一次实际执行。
它会有：

- round id
- file fingerprint
- audit packet
- audit report
- run id / session key
- verdict

### 3.4 `hook point aggregate`

同一个节点上可以挂多个 hook，所以系统还需要一个节点级聚合结果：

- `pass`
- `revise`
- `block`

这是控制平面真正消费的结果。

## 4. 当前已接入的稳定 hook 点

当前代码里真正接通的，是下面这些边界。

### 4.1 `artifact_materialized`

入口：

- [`tools/workflow-guard-runtime/stage-preflight.ts`](../../tools/workflow-guard-runtime/stage-preflight.ts)
- [`tools/workflow-guard-runtime/auto-iterator.ts`](../../tools/workflow-guard-runtime/auto-iterator.ts)

语义：

- stage preflight 刚 materialize / reconcile 完关键 contract
- 但系统还没有进入下一次 stage dispatch

为什么这个点重要：

- 这是最稳定的“产物刚出现”边界
- 不需要文件系统 watcher
- 能在 handoff 前检查“新产物虽然出来了，但还没通过审查”

### 4.2 `before_stage_handoff`

入口：

- [`tools/register-workflow-service.ts`](../../tools/register-workflow-service.ts)

位置：

- 在 auto discussion / mitigation 之后
- 在 `maybeLaunchAutoStageForProject(...)` 之前

语义：

- 当前 stage 准备真正 handoff 给下一位 owner

为什么这个点重要：

- 它是自动推进主路径上的第一闸门
- 最适合挂“写完了但要先审一下”的规则

### 4.3 `before_task_complete`

入口：

- [`tools/workflow-team/task-hooks.ts`](../../tools/workflow-team/task-hooks.ts)
- [`tools/register-workflow-tools.ts`](../../tools/register-workflow-tools.ts) 的 `complete_task`

语义：

- task 的 deterministic verification 已通过
- 但 task 还没有被真正标成 `satisfied`

这让系统可以表达：

- “基础状态没问题，但这份文件还得先过审核”

### 4.4 `before_handoff_activation`

入口：

- [`tools/workflow-handoff/handoff-activation.ts`](../../tools/workflow-handoff/handoff-activation.ts)
- 通过 [`tools/register-workflow-tools.ts`](../../tools/register-workflow-tools.ts) 和 [`tools/register-workflow-hooks.ts`](../../tools/register-workflow-hooks.ts) 调用

语义：

- handoff intent 已存在
- target role 也 claim 了
- 但 manifest 的 `owner_agent/current_stage` 还没真正切换

这是 runtime 级最终兜底 gate。

### 4.5 `after_handoff_activation`

入口同上。

语义：

- owner/stage 已经切换
- 现在只适合做非阻塞 post-handoff 处理

适合：

- 审计记录
- 低风险通知
- dashboard 补充信息

不适合：

- 再去回滚 owner/stage

## 5. 保留但尚未主接入的 hook 点

下面两个点已经在合同里保留，但当前不是主执行入口：

- `after_stage_handoff`
- `before_stage_complete`

它们保留的原因是：

- 后续可以接更细的 closeout / notification 规则
- 但当前最稳定、收益最高的边界已经先接在 handoff 前和 activation 前后

## 6. 配置长什么样

hook policy 放在：

- `PROJECT_MANIFEST.json.workflow_hooks`

同时兼容历史别名：

- `PROJECT_MANIFEST.json.workflow_audit.checkpoints`

一个典型的 `file_audit` hook:

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
      }
    ]
  }
}
```

## 7. 多个 hook 怎么挂在同一个节点

一个节点可以挂多个 hook。

例如 `before_stage_handoff` 上同时挂：

- claim audit
- citation audit
- structure audit

系统不会把它们当成一条大 prompt，而是多条独立 hook policy。

### 7.1 排序与并发

执行时按下面规则稳定排序：

1. `hook_point`
2. `stage`
3. `parallel_group`
4. `order`
5. `hook_id`

### 7.2 聚合结果

每个 hook 先独立得到：

- `pass`
- `revise`
- `block`

hook point 再聚合成：

- 任一 `block` => point 结果 `block`
- 无 `block` 但任一 `revise` => point 结果 `revise`
- 全部 `pass` => point 结果 `pass`

### 7.3 为什么只发一条 revision dispatch

如果 3 个 auditor 都直接给 writer 发消息，session transcript 很快会被打爆，还可能互相矛盾。

所以当前实现做的是：

1. 每个 hook 保留自己的 packet / report
2. control plane 生成一份 aggregate revision packet
3. 只向 `revise_owner_role` 派发一条聚合修订任务

## 8. Runtime state 在哪里

高频运行态不直接塞进 manifest，而是存在：

- `.openclaw-research/workflow-hooks-state.json`

它记录：

- 每个 hook 的状态
- 当前 active round
- last reviewed fingerprint
- last passed fingerprint
- consecutive unchanged rounds
- last revision dispatch
- hook point aggregate 状态

## 9. File audit packet / report 在哪里

`file_audit` 会为每一轮生成：

- `reviewer/file-audits/<hook_id>/round-<n>/AUDIT_PACKET.md`
- `reviewer/file-audits/<hook_id>/round-<n>/AUDIT_PACKET.json`
- `reviewer/file-audits/<hook_id>/round-<n>/AUDIT_REPORT.json`
- `reviewer/file-audits/<hook_id>/round-<n>/AUDIT_REPORT.md`

以及节点级聚合修订包：

- `reviewer/file-audits/_aggregate/<stage>-<hook_point>/AGGREGATE_REVISION_PACKET.md`

这让系统具备几个很重要的特性：

- reviewer 不是黑盒
- revision 不依赖聊天上下文
- target agent 可以读上一轮的结构化问题
- 同一内容能靠 fingerprint 去重

## 10. file audit 怎么跑

当前的 file audit runner 在：

- [`tools/workflow-hooks/file-audit-runner.ts`](../../tools/workflow-hooks/file-audit-runner.ts)

它做四件事：

1. 计算目标文件 fingerprint
2. 物化 audit packet
3. 构造只允许返回 JSON 的 reviewer prompt
4. 解析 reviewer 结果并落盘 report

reviewer 必须返回类似这样的 JSON：

```json
{
  "verdict": "revise",
  "summary": "The file contains one unsupported claim.",
  "violations": [
    {
      "rule": "unsupported_claim",
      "severity": "high",
      "location": "section 2",
      "message": "The claim is missing support."
    }
  ],
  "requiredFixes": [
    "Delete or soften the unsupported claim."
  ],
  "reviewedArtifacts": [
    "academic_writer/paper/main.tex"
  ],
  "confidence": 0.8
}
```

如果 reviewer 返回无效 JSON，系统按 `block` 处理。

## 11. 为什么一定要用 fingerprint

hook 不是简单“审过一次就算了”，而是要知道：

- 这次审的是哪版文件
- 上次 pass 的是不是同一版内容
- target agent 有没有真的改文件

所以实现里统一使用文件内容 hash，而不是 `mtime`。

## 12. Hook executor 在哪里

当前的聚合执行器在：

- [`tools/workflow-hooks/executor.ts`](../../tools/workflow-hooks/executor.ts)

它是唯一应该理解下面这些事情的地方：

- 如何筛选命中的 hook
- 如何启动 reviewer run
- 如何轮询结果
- 如何更新 runtime state
- 如何决定 point aggregate verdict
- 如何触发 aggregate revision dispatch

## 13. 控制平面里谁调用谁

当前主链大致是：

```text
stage-preflight
  -> emittedHookEvents / materializedArtifacts
  -> auto_iterator
  -> service heartbeat
  -> before_stage_handoff hooks
  -> stage dispatch
  -> handoff activation
  -> before_handoff_activation hooks
  -> owner/stage switch
  -> after_handoff_activation hooks
```

task 线则是：

```text
claim task
  -> deterministic verification
  -> before_task_complete hooks
  -> complete task
  -> auto-claim next task
```

## 14. 为什么 `stage-preflight` 现在要发事件

以前 `stage-preflight` 只返回：

- `materializedContracts`
- `errors`

对日志来说够用，但对 `artifact_materialized` hook 不够。

因为它需要知道：

- 这轮到底 materialize 了什么
- 是创建、更新，还是 reconcile
- 下一步是不是该跑审计

所以现在它还会返回：

- `materializedArtifacts`
- `emittedHookEvents`

## 15. 为什么 service 里还要有 `before_stage_handoff`

因为 `auto_iterator` 自己只负责算：

- stage
- owner
- missing signals
- recommended actions

真正“要不要派发 handoff”，还是 service 主循环里做。

所以 hook 最稳定的主入口不是直接写进某个 role prompt，而是：

- 在 [`tools/register-workflow-service.ts`](../../tools/register-workflow-service.ts) 的 dispatch 前插 `before_stage_handoff`

## 16. 为什么 handoff activation 还要再兜底一次

因为 service 不是唯一入口。

handoff 还可能来自：

- runtime recovery
- prompt hook 路径里的 claim-and-activate
- 显式工具动作

所以 `before_handoff_activation` 是 runtime 级 final safety net。

## 17. `research_workflow` 里新增了哪些动作

当前和 hooks 直接相关的 runtime actions:

- `get_file_audit_state`
- `set_file_audit_policy`
- `materialize_file_audit_packet`

它们的作用分别是：

### 17.1 `get_file_audit_state`

查看：

- 当前 manifest 里的 hook policy
- runtime hook state store

### 17.2 `set_file_audit_policy`

把新的 file audit hooks 写进 manifest。

### 17.3 `materialize_file_audit_packet`

手动为某个 hook 生成 packet。

## 18. Module Map 里如何定位这层代码

最常看的入口是：

- [`tools/workflow-hooks/contracts.ts`](../../tools/workflow-hooks/contracts.ts)
- [`tools/workflow-hooks/state.ts`](../../tools/workflow-hooks/state.ts)
- [`tools/workflow-hooks/executor.ts`](../../tools/workflow-hooks/executor.ts)
- [`tools/workflow-hooks/file-audit-runner.ts`](../../tools/workflow-hooks/file-audit-runner.ts)
- [`tools/workflow-hooks/revision-dispatch.ts`](../../tools/workflow-hooks/revision-dispatch.ts)

网关位置则在：

- [`tools/workflow-guard-runtime/stage-preflight.ts`](../../tools/workflow-guard-runtime/stage-preflight.ts)
- [`tools/register-workflow-service.ts`](../../tools/register-workflow-service.ts)
- [`tools/workflow-team/task-hooks.ts`](../../tools/workflow-team/task-hooks.ts)
- [`tools/workflow-handoff/handoff-activation.ts`](../../tools/workflow-handoff/handoff-activation.ts)

## 19. 当前实现刻意没有做什么

为了稳定，当前实现有一些刻意保守的选择：

- 只正式支持 `file_audit`
- hook point 用固定枚举，不支持任意 callback
- 不让 hook 直接改 owner/stage
- 不做文件系统 watcher
- 不把 hook 混进 prompt-only hooks
- 多 hook 失败时只发一条 aggregate revision dispatch

## 20. 扩展新 hook type 时的原则

如果未来要加新的 hook type，比如：

- schema audit
- packet completeness audit
- human approval hook

建议遵循同一模式：

1. policy 进 manifest
2. state 进 `.openclaw-research/workflow-hooks-state.json`
3. runner 负责 type-specific packet / parser
4. executor 负责 point 级调度与聚合
5. gateway 只在稳定边界调用 executor

最重要的一条是：

> 不要再在 `register-workflow-service.ts` 里长出第四套、第五套 feature-specific reviewer loop。
