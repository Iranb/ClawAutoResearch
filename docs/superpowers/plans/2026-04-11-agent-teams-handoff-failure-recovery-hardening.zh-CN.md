# Agent Teams Handoff 与失败补救强化计划

> **Status:** DRAFT

> **Scope:** 这份计划专门补齐当前 `openclaw-research` workflow 与 Claude Agent Teams 协作模型之间的差距，重点关注 **Agent 间任务交接 handoff** 与 **Agent 执行失败后的自动补救策略**。它不是替代 `2026-04-11-agent-teams-style-workflow-team-runtime.zh-CN.md`，而是该计划之后的 hardening plan。

**目标：** 把当前已经有的 `task graph + claim/lease + complete_task + mailbox + team round` 从“可用的任务状态机”升级成“接近 Agent Teams 的协作运行时”：

- teammate 完成任务后自动把成果、artifact、验证结果、后续依赖交给下游 owner。
- teammate 失败或验证不通过时自动创建 repair task、通知 lead、支持重试/转派。
- teammate 空闲或 stop 前由 hook 检查是否还有可做任务，避免 agent 停在半路。
- lead 可以清楚看到每个 teammate 的 claim、完成、失败、阻塞、handoff 和 repair 历史。
- 对 survey / experiment 两条 workflow line 都不引入错误 owner 或错误 stage。

---

## 1. 当前代码与 Agent Teams 指南的对照结论

参考文档：

- [Claude Code Agent Teams Workflow](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/agent-teams.md)

该指南描述的 Agent Teams 关键机制包括：

- Team lead 负责拆任务、spawn teammates、汇总结果。
- Teammates 有独立上下文。
- 共享 task list 带 task claiming。
- 通过 mailbox 做 peer-to-peer messaging。
- 任务依赖能自动解锁。
- 多 agent 通过 shared state / git-based locking 协作。
- 失败时需要清晰的 limitation / recovery / conflict handling。

当前 `openclaw-research` 已经具备一部分基础：

- `tools/workflow-team/task-graph.ts`
  - 支持 task graph、claim、renew、release、lease expiry、dependency-aware claim。
- `tools/workflow-team/team-round.ts`
  - 支持 stage-level team round 摘要。
- `tools/workflow-team/task-hooks.ts`
  - 支持 `complete_task -> verify -> satisfied / needs_repair -> auto-claim next`。
- `tools/workflow-collaboration/mailbox.ts`
  - 支持 mailbox 基础读写、ack、dedupe。
- `tools/register-workflow-tools.ts`
  - 暴露 `claim_task / complete_task / release_task / get_task_graph / get_team_round` 等工具。
- `tools/register-workflow-service.ts`
  - auto-stage dispatch 成功后会 claim task；session terminal 后会 release claims。

但是，如果按 Agent Teams 的 handoff / failure recovery 标准审查，当前框架仍有明显缺口。

---

## 2. 已具备能力

### 2.1 共享任务图

当前 `workflow-task-graph.json` 已经可以表达：

- task id
- title
- owner
- status
- dependsOn
- verificationRule
- verificationStatus
- lease
- satisfiedAt / satisfiedBy / completionNote
- latest event

这已经满足 Agent Teams 中 “shared task list + task claiming” 的基础需求。

### 2.2 最小 claim / lease

当前 task graph 支持：

- `claimWorkflowTask`
- `claimNextWorkflowTaskForOwner`
- `renewWorkflowTaskLease`
- `releaseWorkflowTaskClaim`
- `releaseWorkflowTasksForSession`
- `reconcileWorkflowTaskGraphLeases`

这已经可以避免同一个 task 被多个 agent 同时执行。

### 2.3 完成后 self-claim

`completeWorkflowTaskAndContinue(...)` 已经支持：

1. 当前 task 进入 verifying
2. 按 verification rule 验证
3. 通过后标记 satisfied
4. 记录 team round completion
5. 为同一 role/session claim 下一个可做 task

这覆盖了“做完一个节点后继续做事情”的最小闭环。

### 2.4 Dashboard 可见性

Dashboard detail 已经能看到：

- top-tier verdict
- team round lead
- active sessions
- task graph counts
- task board
- evidence board

这对运营 Team Runtime 是必要基础。

---

## 3. 关键缺口

### 3.1 缺口 A：任务完成不会自动 handoff 给下游 owner

当前行为：

- `complete_task` 完成后只会给当前 role/session 尝试 claim next task。
- 如果当前 agent 没有可 claim 的任务，但下游 owner 有可做任务，系统不会自动发 mailbox 给下游 owner。
- 依赖解锁后没有 “dependency_unblocked” event/handoff。

风险：

- lead / next owner 不知道 upstream task 已完成。
- agent 可能在完成后停止，而下游 owner 没被唤醒。
- dashboard 只能看到状态变化，不一定能触发执行。

需要补齐：

- Task completed -> notify lead
- Task completed -> notify next owner if dependency unlocked
- Task completed -> emit handoff receipt
- Task completed -> attach artifact/verification summary

### 3.2 缺口 B：失败后没有团队级 repair orchestration

当前行为：

- verification 失败后 task 变为 `needs_repair`。
- 当前 session 继续持有该 task。
- 如果 agent 不继续修，系统只能等 lease 过期或 session terminal cleanup。

风险：

- 失败 task 卡在原 agent 手里。
- lead 不一定收到失败原因。
- 没有 retry budget，可能无限修或无人修。
- 没有把 repair 拆成 task，也没有转派给更合适的 owner。

需要补齐：

- needs_repair -> notify lead
- needs_repair -> create repair task
- needs_repair -> attach failure reason / failing verification rule
- needs_repair -> retry budget
- needs_repair -> reassign policy

### 3.3 缺口 C：TeammateIdle 不是强制 hook

当前行为：

- heartbeat 时可以 claim task 并注入 guidance。
- 但 agent stop / idle 前不会被强制拦截。
- 如果 agent 没主动调用 `complete_task`，框架不会自动完成或修复。

风险：

- agent 做完自然语言报告后停止，但 task graph 仍是 claimed。
- agent 忘记调用 `complete_task`，下游任务不解锁。
- lead 看到 task stuck。

需要补齐：

- stop/idle hook 检查当前 lease
- 如果 task 已有 artifact-ready evidence，自动尝试 complete
- 如果 task 未完成，阻止 idle 并给出 repair instruction
- 如果无 current lease，则 claim next task 或真正 idle

### 3.4 缺口 D：Mailbox 与 task lifecycle 没有深绑定

当前 mailbox 是通用 handoff side channel，但 task graph lifecycle 没有自动使用 mailbox。

缺少事件：

- task_claimed -> lead optional notify
- task_completed -> lead / next owner
- task_failed -> lead / repair owner
- task_unblocked -> next owner
- task_reassigned -> old owner + new owner
- team_round_ready -> lead

需要补齐：

- task lifecycle event -> mailbox message
- mailbox ack -> task handoff receipt
- stale mailbox -> reconcile / expire

### 3.5 缺口 E：缺少 artifact receipt contract

当前 `completionNote` 是自由文本。

Agent Teams 的 handoff 需要结构化交接：

- changed files
- artifacts produced
- verification performed
- evidence pointers
- assumptions
- unresolved blockers
- next suggested task

没有这个 contract，lead/next owner 很难判断是否能接手。

### 3.6 缺口 F：缺少 lead synthesis / team closeout

当前 `team-round` 只是摘要：

- leadRole
- active sessions
- last claimed/completed
- counts

缺少：

- lead inbox
- team closeout packet
- stage closeout proof
- teammate contribution summary
- unresolved blocker list
- decision log

### 3.7 缺口 G：缺少 conflict / shared file safety

Agent Teams guide 提到：

- read-heavy tasks 更适合 teams
- write-heavy tasks 容易冲突
- 需要 clear boundaries / single-writer pattern

当前 task graph 没有：

- write scope ownership
- file lock
- conflict detection
- single-writer enforcement
- artifact-level ownership

对于 workflow 这种多 agent 同时写 manifest / runtime state / paper artifacts 的系统，这是风险点。

### 3.8 缺口 H：PaperNexus retry 与 exec packet 仍缺执行确认

当前已经有：

- exec packet
- failed-paper retry manifest
- `queue_paper_ingestion_retry`

仍缺：

- `run_exec_packet` 明确执行入口
- PaperNexus retry graph presence filtering
- retry 完成后的 automatic graph refresh
- retry failure -> repair task

---

## 4. 目标架构：Handoff & Recovery Kernel

新增一层：

```text
Workflow Team Runtime
  task-graph.ts
  team-round.ts
  task-hooks.ts
  task-handoff.ts        <-- new
  task-repair.ts         <-- new
  task-receipts.ts       <-- new
  task-events.ts         <-- new
  teammate-idle.ts       <-- new
```

### 4.1 新增 durable files

每个项目：

- `{PROJ}/.openclaw-research/workflow-task-events.jsonl`
- `{PROJ}/.openclaw-research/workflow-task-handoffs.json`
- `{PROJ}/.openclaw-research/workflow-task-receipts.json`
- `{PROJ}/.openclaw-research/workflow-repair-queue.json`
- `{PROJ}/.openclaw-research/workflow-team-closeout.json`

### 4.2 Task lifecycle events

统一事件类型：

- `task_materialized`
- `task_claimed`
- `task_lease_renewed`
- `task_released`
- `task_verifying`
- `task_completed`
- `task_failed_verification`
- `task_needs_repair`
- `task_reassigned`
- `task_dependency_unblocked`
- `task_handoff_sent`
- `task_handoff_acknowledged`
- `teammate_idle_blocked`
- `teammate_idle_accepted`
- `team_round_closeout_ready`

### 4.3 Handoff object

```ts
type WorkflowTaskHandoff = {
  handoffId: string;
  taskId: string;
  fromRole: string | null;
  fromSessionKey: string | null;
  toRole: string | null;
  toSessionKey: string | null;
  leadRole: string | null;
  stage: string | null;
  reason: "task_completed" | "dependency_unblocked" | "needs_repair" | "manual_reassign";
  artifactReceiptId: string | null;
  verificationStatus: "passed" | "failed" | "not_required";
  messageId: string | null;
  status: "pending" | "acknowledged" | "expired" | "superseded";
  createdAt: string;
  acknowledgedAt: string | null;
};
```

### 4.4 Artifact receipt object

```ts
type WorkflowTaskArtifactReceipt = {
  receiptId: string;
  taskId: string;
  producedBy: string | null;
  sessionKey: string | null;
  summary: string;
  changedFiles: string[];
  artifactPaths: string[];
  evidencePointers: string[];
  verificationCommands: string[];
  verificationResult: "passed" | "failed" | "not_run";
  blockers: string[];
  assumptions: string[];
  nextSuggestedTaskIds: string[];
  createdAt: string;
};
```

### 4.5 Repair task object

```ts
type WorkflowRepairTask = {
  repairId: string;
  sourceTaskId: string;
  stage: string | null;
  owner: string | null;
  suggestedOwner: string | null;
  retryBudgetRemaining: number;
  failureReason: string;
  verificationRule: string;
  status: "queued" | "claimed" | "completed" | "failed" | "escalated";
  createdAt: string;
  updatedAt: string;
};
```

---

## 5. Implementation Plan

### Task 1：Task event log

**Files**

- Create: `tools/workflow-team/task-events.ts`
- Modify: `tools/workflow-team/task-graph.ts`
- Add tests: `tests/workflow-task-events.test.mjs`

**Steps**

- [ ] Add append-only JSONL event log.
- [ ] Emit event on materialize / claim / renew / release / verify / complete / fail.
- [ ] Include `stage`, `taskId`, `role`, `sessionKey`, `reason`, `details`.
- [ ] Make event writes best-effort but durable when possible.

**Acceptance**

- Completing a task writes `task_verifying` and `task_completed`.
- Failed verification writes `task_failed_verification` and `task_needs_repair`.
- Lease expiry writes `task_released` with reason `lease_expired`.

### Task 2：Artifact receipt contract

**Files**

- Create: `tools/workflow-team/task-receipts.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-team/task-hooks.ts`
- Add tests: `tests/workflow-task-receipts.test.mjs`

**Steps**

- [ ] Add `artifactReceipt` param to `complete_task`.
- [ ] Normalize changed files, artifact paths, verification commands, blockers, assumptions.
- [ ] Persist receipt before marking task completed.
- [ ] Include receipt id in task event and handoff.
- [ ] Dashboard may show last receipt summary.

**Acceptance**

- `complete_task` without receipt still works but marks `verificationResult=not_run`.
- `complete_task` with receipt stores durable receipt.
- Next owner handoff includes receipt id and artifacts.

### Task 3：Task handoff integration

**Files**

- Create: `tools/workflow-team/task-handoff.ts`
- Modify: `tools/workflow-team/task-hooks.ts`
- Modify: `tools/workflow-collaboration/mailbox.ts`
- Add tests: `tests/workflow-task-handoff.test.mjs`

**Steps**

- [ ] When task completes, find tasks whose dependencies are now satisfied.
- [ ] For each newly unblocked task, resolve owner.
- [ ] Create mailbox message to next owner.
- [ ] Create lead notification.
- [ ] Persist `workflow-task-handoffs.json`.
- [ ] Mark handoff acknowledged when mailbox item is acked.

**Acceptance**

- Completing upstream task sends mailbox to downstream owner.
- Handoff includes artifact receipt.
- Duplicate completion does not duplicate handoff.

### Task 4：Repair orchestration

**Files**

- Create: `tools/workflow-team/task-repair.ts`
- Modify: `tools/workflow-team/task-hooks.ts`
- Modify: `tools/workflow-team/task-graph.ts`
- Add tests: `tests/workflow-task-repair.test.mjs`

**Steps**

- [ ] Add retry budget to tasks or repair tasks.
- [ ] Verification failure creates repair queue item.
- [ ] Notify lead via mailbox.
- [ ] Optionally release task for reassignment after failure.
- [ ] Add `claim_repair_task` or fold repair tasks into normal task graph.
- [ ] Escalate when retry budget exhausted.

**Acceptance**

- Failed task creates repair task.
- Lead receives failure mailbox.
- Retry budget decrements.
- Exhausted repair escalates to human / lead.

### Task 5：TeammateIdle / Stop hook

**Files**

- Create: `tools/workflow-team/teammate-idle.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Add tests: `tests/workflow-teammate-idle.test.mjs`

**Steps**

- [ ] Add hook entry for stop/idle if supported by plugin API.
- [ ] If no native stop hook exists, add heartbeat fallback and explicit prompt instruction.
- [ ] If session has claimed task:
  - verify whether artifact receipt exists.
  - if not, block idle and ask for complete_task or release_task.
  - if yes, attempt complete.
- [ ] If session has no task:
  - claim next matching task.
  - if none, allow idle.
- [ ] Emit `teammate_idle_blocked` / `teammate_idle_accepted`.

**Acceptance**

- Agent cannot silently idle while holding unfinished claimed task.
- Agent with no task can claim next task on idle heartbeat.
- Idle block reason is explicit and actionable.

### Task 6：Lead synthesis / closeout packet

**Files**

- Create: `tools/workflow-team/team-closeout.ts`
- Modify: `tools/workflow-team/team-round.ts`
- Modify: dashboard read model
- Add tests: `tests/workflow-team-closeout.test.mjs`

**Steps**

- [ ] Summarize completed tasks.
- [ ] Summarize receipts.
- [ ] Summarize failed/repair tasks.
- [ ] Summarize unresolved blockers.
- [ ] Determine whether stage closeout is ready.
- [ ] Persist `workflow-team-closeout.json`.

**Acceptance**

- Lead can inspect one closeout packet before stage advance.
- Dashboard shows closeout readiness.
- Stage closeout blocks if unresolved repair tasks exist.

### Task 7：Peer-to-peer mailbox conventions

**Files**

- Modify: `tools/workflow-collaboration/mailbox.ts`
- Modify: `tools/workflow-handoff-runtime.ts`
- Modify: `tools/workflow-team/task-handoff.ts`
- Add tests: `tests/workflow-peer-mailbox.test.mjs`

**Steps**

- [ ] Add mailbox kind `task_handoff`.
- [ ] Add mailbox kind `repair_request`.
- [ ] Add `replyToMessageId`.
- [ ] Add `taskId`.
- [ ] Add `artifactReceiptId`.
- [ ] Add dedupe key.

**Acceptance**

- Peer owner can reply to handoff.
- Lead can trace handoff thread.
- Duplicate handoff is deduped.

### Task 8：Conflict / write-scope safety

**Files**

- Create: `tools/workflow-team/write-scope.ts`
- Modify: `tools/workflow-team/stage-profiles.ts`
- Modify: `tools/register-workflow-tools.ts`
- Add tests: `tests/workflow-write-scope.test.mjs`

**Steps**

- [ ] Add `writeScope` to task profile.
- [ ] Add `exclusiveFiles` and `ownedDirs`.
- [ ] Warn/deny claims that overlap active task write scopes.
- [ ] Add single-writer policy for:
  - `PROJECT_MANIFEST.json`
  - `TRACK_REGISTRY.json`
  - `workflow-task-graph.json`
  - paper source `.tex` files
- [ ] Add dashboard warning for overlapping write scopes.

**Acceptance**

- Two agents cannot claim tasks with conflicting exclusive files.
- Read-only tasks can run in parallel.
- Lead can override with explicit force flag.

### Task 9：PaperNexus retry completion and graph presence filtering

**Files**

- Modify: `tools/paper-ingestion-failures.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/graph-presence.ts`
- Add tests: `tests/paper-ingestion-retry.test.mjs`

**Steps**

- [ ] Read latest `GRAPH_PRESENCE_CHECK.json`.
- [ ] Optionally run fresh graph presence check before retry.
- [ ] Match failed papers against present papers by arXiv / DOI / sourceKey / title signature.
- [ ] Mark already-in-graph skipped.
- [ ] After retry queued/completed, auto-refresh graph presence.
- [ ] Convert remaining failures into repair tasks.

**Acceptance**

- Already-in-graph failures are not resubmitted.
- Retry completion refreshes graph presence.
- Remaining retry failures create repair tasks.

### Task 10：Exec packet runner

**Files**

- Modify: `tools/workflow-execution/exec-packet.ts`
- Modify: `tools/register-workflow-tools.ts`
- Add tests: `tests/workflow-exec-budget.test.mjs`

**Steps**

- [ ] Add tool action `run_exec_packet`.
- [ ] Validate packet id/path is under `{PROJ}/.openclaw-research/exec-packets`.
- [ ] Verify sha256 before execution.
- [ ] Execute only through approved local/runtime surface.
- [ ] Record result in `exec-packets/{packetId}.result.json`.
- [ ] Convert OpenClaw approval errors into repair messages.

**Acceptance**

- Long command is materialized.
- Agent can call `run_exec_packet`.
- Result is durable.
- Discord never receives full command.

---

## 6. Verification Plan

### Required Tests

- `node --test tests/workflow-task-events.test.mjs`
- `node --test tests/workflow-task-receipts.test.mjs`
- `node --test tests/workflow-task-handoff.test.mjs`
- `node --test tests/workflow-task-repair.test.mjs`
- `node --test tests/workflow-teammate-idle.test.mjs`
- `node --test tests/workflow-team-closeout.test.mjs`
- `node --test tests/workflow-peer-mailbox.test.mjs`
- `node --test tests/workflow-write-scope.test.mjs`
- `node --test tests/paper-ingestion-retry.test.mjs`
- `node --test tests/workflow-exec-budget.test.mjs`

### Regression Matrix

- `node --test tests/auto-iterator.test.mjs`
- `node --test tests/workflow-runtime-tools.test.mjs`
- `node --test tests/workflow-service.test.mjs`
- `node --test tests/workflow-fast-paths.test.mjs`
- `node --test tests/workflow-runtime-orchestrator.test.mjs`
- `node --test tests/workflow-hook-prompt-isolation.test.mjs`
- `node --test tests/workflow-team-runtime.test.mjs`
- `npm run dashboard:test`

---

## 7. Current Review Recommendation

**Recommendation:** `REQUEST CHANGES` before claiming Agent Teams parity.

原因：

- 当前框架已经有 task graph 和 completion continuation。
- 但 handoff 还没有自动通知下游 owner。
- 失败补救还没有 repair queue / retry budget / lead escalation。
- idle hook 还不是强制 stop/idle gate。
- exec packet 和 PaperNexus retry 已有基础，但生产级执行确认与 graph-presence filtering 仍需补齐。

换句话说：

- 当前是 **Agent Teams-inspired task runtime**。
- 目标应升级为 **Agent Teams-style collaborative runtime**。

