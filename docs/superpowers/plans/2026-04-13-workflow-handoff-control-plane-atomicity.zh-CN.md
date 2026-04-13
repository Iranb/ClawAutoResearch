# Workflow Handoff 原子化与可靠性交付收敛方案

**状态：** proposed  
**日期：** 2026-04-13  
**目标：** 把当前容易出现“owner 已切换但任务没有真正交到下一个 agent”半状态的 handoff 流程，重构成一个由 workflow 控制面统一管理、可恢复、可重试、可观测、不会阻塞主流程、且对 survey 与 research 两条主线都稳定适用的原子任务接力系统。

---

## 1. 背景

近期真实运行暴露出的 handoff 问题有几个稳定模式：

- manifest / snapshot 已经显示 `owner_agent` 变成了下一个角色
- 但实际 `workflow-handoff-intents.json` 只有 `pending`
- `deliveryAttempts` 为空
- 目标角色没有任何 runtime session / queue / mailbox claim
- Discord 没看到阶段推进消息，或者看到的是旧阶段消息

也就是说，当前系统存在典型的**半交接状态**：

1. 状态上已经切 owner
2. 运行上并没有真正接力
3. 恢复时又很难判断到底谁应该继续干活

这个问题在 survey 主线里表现为：

- `survey_review -> write`
- `academic_writer` 成为 owner
- 但真正运行的还是 `researcher` 的 background session

在 research 论文主线里表现为：

- `idea -> plan`
- `plan -> code`
- `experiment -> analyze`
- 某一步 manifest 已推进，但 coder / analyzer / reviewer 实际未启动

---

## 2. 核心问题

### 2.1 owner 切换和任务交付不是同一件事

当前实现里，“owner 变更”和“handoff delivery”不是原子操作：

- auto-iterator 或状态 setter 先把 `owner_agent` / `current_stage` 改掉
- 然后再尝试 handoff delivery
- 如果 delivery 失败，就会留下“逻辑上交给别人了，但实际上没人接”

### 2.2 handoff 存在双轨事实源

现在至少有两种 handoff 痕迹：

- 真正尝试 delivery 的 intent
- 只为广播/说明而生成的 `stageHandoff` 壳 intent

这会导致：

- `pending` intent 不一定代表真正进入 delivery
- 排查时很难判断“哪个 intent 是真的”

### 2.3 session / binding / owner 三者还没完全统一

真实运行中已经见过：

- command 来自 `orchestrator` 会话
- 但任务本应交给 `researcher`
- background continuation 却挂在了错误 session tree 上

即使 owner 理论上正确，session 选错也会导致实际执行偏航。

### 2.4 通知副作用仍会反向污染主流程

事件广播当前仍可能因为：

- 文件名过长
- binding 不一致
- channel broadcast 失败

而让 handoff 看起来像失败，甚至干扰调试判断。

### 2.5 恢复逻辑缺少“半交接修正”

当前 heartbeat / maintenance 更擅长：

- repair queue
- repair sessions
- replay broadcast

但对这类状态还不够强：

- pending handoff 但 owner 已切换
- owner 已切换但目标无 session
- 旧 owner session 还活着，目标 owner 未 claim

---

## 3. 设计目标

### 3.1 主目标

实现一个**workflow-owned atomic handoff control plane**：

- owner 切换晚于目标 claim
- delivery 与 owner 激活具备清晰状态机
- 失败可回滚
- 恢复可自动修正半交接
- 失败后会自动 retry / backoff / re-drive
- delivered 但未 claim 的 handoff 会被 watchdog 继续追踪
- 关键 handoff 有统一可观测视图
- 通知完全异步，不阻塞主流程

### 3.2 设计原则

1. **workflow 接管 control plane，agent 保留 worker plane**
2. **manifest 不再抢跑 owner**
3. **单一事实源**
4. **retry / ack / watchdog 是 control plane 的一部分**
5. **所有通知异步**
6. **session 选取 deterministic**
7. **binding 校验宁可保守，不允许串项目**
8. **survey / research 使用同一协议，不同验收条件**

### 3.3 非目标

以下不属于本轮目标：

- 改造 agent 本身的领域技能内容质量
- 重写 Discord transport
- 让所有旧项目历史状态自动迁移到完美结构
- 做全功能 UI 可视化 handoff dashboard

说明：

- 轻量 `/handoff-status` 诊断视图在本轮范围内
- 但不做完整前端 dashboard

---

## 4. 控制面 / 执行面分层

### 4.1 Workflow Control Plane

workflow 负责：

- 判断阶段是否可交接
- 生成 handoff packet
- 选择目标角色
- 选择目标 session
- 执行 dispatch / retry / supersede / timeout / rollback
- 维护 ack watchdog / retry sweep / cooldown/backoff
- 管理 owner truth
- 记录事件与 outbox
- 恢复半交接状态

### 4.2 Agent Worker Plane

agent 负责：

- `claim`
- `heartbeat`
- `complete`
- `fail`
- 真正产出 artifacts

### 4.3 规则

agent 不再“自己改 owner”。

agent 只说：

- 我完成了阶段产物
- 我 claim 了某个 handoff
- 我执行失败了

而 workflow 决定：

- 是否切 owner
- 是否推进 stage
- 是否重试 / 回滚 / supersede

---

## 5. 统一状态机

### 5.1 handoff intent 状态

新增或重定义以下状态：

- `prepared`
- `dispatched`
- `acknowledged`
- `claimed`
- `activated`
- `completed`
- `failed`
- `superseded`
- `expired`

### 5.2 含义

- `prepared`
  源 owner 已满足交接前置条件，handoff packet 已生成，但还未实际投递
- `dispatched`
  已经向目标角色的一个或多个 delivery surface 投递
- `acknowledged`
  至少一个 delivery surface 明确确认收到
- `claimed`
  目标 agent/session 显式 claim 了这条任务
- `activated`
  workflow 已将 manifest owner / orchestration_state 与目标 owner 对齐
- `completed`
  目标 owner 完成了本阶段职责
- `failed`
  投递或接力失败
- `superseded`
  被新的 handoff 替代
- `expired`
  长时间无人 claim

### 5.3 最重要的原子约束

只有在 `claimed -> activated` 之后，以下字段才允许变更：

- `PROJECT_MANIFEST.json.owner_agent`
- `PROJECT_MANIFEST.json.current_stage`
- `orchestration_state.current_owner`

也就是说：

- `pending / prepared / dispatched / acknowledged`
  都不代表 owner 已变
- owner truth 仍然属于旧 owner

---

## 6. Manifest / Orchestration 扩展字段

在 `orchestration_state` 中增加：

- `current_owner`
- `pending_handoff_id`
- `pending_owner_candidate`
- `handoff_phase`
- `current_execution_id`
- `owner_claimed_at`
- `owner_activation_deadline`
- `rollback_target_owner`
- `last_handoff_error`

### 6.1 含义

- `current_owner`
  当前真正生效的 owner
- `pending_handoff_id`
  当前待交接 intent
- `pending_owner_candidate`
  下一个候选 owner
- `handoff_phase`
  `idle|prepared|dispatched|claimed|activated|failed`
- `current_execution_id`
  当前阶段执行批次 id，用于幂等与恢复
- `owner_claimed_at`
  目标 owner claim 时间
- `owner_activation_deadline`
  目标 claim / activate 的超时时间
- `rollback_target_owner`
  交接失败后的回滚 owner
- `last_handoff_error`
  上一条 handoff 失败原因

---

## 7. 单一事实源

### 7.1 保留的事实源

保留一个主 intent store：

- `workflow-handoff-intents.json`

保留一个事件流：

- `workflow-handoff-events.jsonl`

### 7.2 删除或弱化的歧义层

不再生成“只为广播存在”的伪 handoff intent。

如果需要广播 stage transition：

- 引用已有 intent id
- 但不单独再造一个 pending intent

### 7.3 规则

任何地方如果要表示 handoff，都必须引用同一个：

- `pending_handoff_id`
- `handoff intent`
- `deliveryAttempts`

不能再出现第二套“只给广播看”的 handoff 影子状态。

---

## 8. Handoff Packet 设计

每次 handoff 必须生成完整 packet，不再只有 summary / command：

- `intentId`
- `projectId`
- `projectRoot`
- `workflowLine`
- `stageBefore`
- `stageAfter`
- `fromRole`
- `toRole`
- `summary`
- `command`
- `blockingSummary`
- `requiredArtifacts`
- `acceptanceChecks`
- `sessionBindingKey`
- `requesterSessionKey`
- `preferredSessionKeys`
- `idempotencyKey`
- `executionId`

### 8.1 acceptanceChecks

这是 handoff 稳定性的关键。  
目标 owner claim 前，packet 必须带明确的完成标准。

例如 survey `survey_review -> write`：

- `SURVEY_QUERY_REGISTRY.json exists`
- `INCLUDED_PAPERS.json exists`
- `EXCLUDED_PAPERS.json exists`
- `SOTA_MATRIX.md exists`
- `GAP_SYNTHESIS.md exists`
- `SURVEY_BRIEF.md exists`

例如 research `plan -> code`：

- `PLAN.md exists`
- `TODOS.md exists`
- `PLAN_AUDIT.md exists`
- `research_program.plan_selection.selected_track_id != null`

---

## 9. Session 解析与 delivery 选择

### 9.1 统一规则

session 选择必须先标准化：

1. 从 channel binding 解析项目
2. 从 role 推导 canonical role session
3. 从 capability store / runtime inventory 里选最合适 session
4. dispatch 前做 session liveness probe
5. 失败后 fallback 到 queue / mailbox

### 9.2 不允许的行为

- 不允许直接继承当前活跃会话作为目标 owner session
- 不允许因为 slash command 是 orchestrator 发起，就把 researcher/writer continuation 挂到 orchestrator tree

### 9.3 目标

researcher 的后台任务永远落在 researcher lane  
writer 的后台任务永远落在 academic_writer lane

### 9.4 Binding gate 设计原则

binding gate 继续保守，但要更准确：

1. 默认仍要求当前 channel 最新 binding 与 `intent.projectRoot` 一致
2. 允许的唯一软化场景是：
   - 同一频道同一项目的 alias key 形态不同
   - 例如 `binding:*` key 与 direct `discord:channel:*` key 指向同一 `projectRoot`
3. 不允许因为“目录在磁盘上存在”就放行 handoff
4. 不允许因为“fromSessionKey 可用”就越过当前 channel binding

目标是：

- 修正 alias / canonicalization 问题
- 不重新引入跨项目串台

---

## 10. 原子 handoff 执行流程

### 10.1 source owner 完成阶段

1. source owner 调 `complete_stage_packet`
2. workflow 校验 `requiredArtifacts`
3. 生成 `handoff intent`，状态=`prepared`
4. `orchestration_state.pending_handoff_id = intentId`
5. owner 仍不切换

### 10.2 dispatch

1. workflow 选 session / queue / mailbox
2. intent -> `dispatched`
3. 记录 `deliveryAttempts`

### 10.3 claim

1. target agent/session 明确 claim
2. intent -> `claimed`
3. `owner_claimed_at` 记录

### 10.4 activate

1. workflow 将：
   - `owner_agent`
   - `current_owner`
   - `current_stage`
   - `execution_id`
   原子更新
2. intent -> `activated`

### 10.5 complete / fail

1. target 完成后：
   - intent -> `completed`
2. target 失败后：
   - intent -> `failed`
   - workflow 决定 retry / rollback / supersede

### 10.6 可靠性交付补强

在不破坏原子 handoff 主线的前提下，补上以下策略：

#### a. retry sweep

- 每次 `auto_iterator_tick` / maintenance / coordinator pass 开始时
- 先扫描 `status in {prepared, dispatched, acknowledged, failed}` 且未超总预算的 intent
- 对符合条件的 intent 重新 delivery
- 不新建影子 intent

#### b. 自适应 cooldown / backoff

- 成功 delivery 后：长 cooldown，避免刷屏
- 显式失败后：短 cooldown，允许快速 retry
- timeout / no-ack：中等 cooldown

也就是说：

- cooldown 应抑制“重复成功投递”
- 不能抑制“失败后的恢复性重投”

#### c. delivered-but-unacked watchdog

- `dispatched`/`acknowledged` 超过 `ackDeadline` 仍无人 claim
- 则自动进入下一轮重投或 fallback channel
- 同时保留原 intent 的 attempt 历史

#### d. session liveness probe

- native dispatch 前先探测目标 session 是否可用
- 对明显死亡/失联 session 不浪费主 dispatch budget
- 直接换下一个 candidate

#### e. queue 不能成为黑洞

- `runtime_queue` 只能作为 durable fallback
- 必须有独立 drain/reconcile 入口
- 不允许“仅入队、不消费”成为默认成功路径

#### f. mailbox 只能做兼容兜底

- mailbox 不再被视为主动唤醒机制
- 仅作为兼容证据与人工恢复线索
- 不能替代 active dispatch

---

## 11. 恢复与半交接修正

新增一个 **handoff reconciler**，在 heartbeat / maintenance / coordinator pass 中执行：

### 11.1 情况 A：manifest owner 已变，但目标无 session/claim

动作：

- 回滚 owner 到旧 owner
- intent -> `failed`
- 记录 `last_handoff_error = activation_without_claim`

### 11.2 情况 B：intent pending/dispatched，但目标 session 已存在且匹配 execution

动作：

- 自动 claim
- 进入 `activated`

### 11.3 情况 C：目标已 claim，但长期无 heartbeat

动作：

- intent -> `failed` 或 `expired`
- 恢复旧 owner 或重新排队

### 11.4 情况 D：新的 owner 版本出现，旧 handoff 仍 pending

动作：

- 旧 intent -> `superseded`

### 11.5 情况 E：intent 已 dispatched，但存在 writer/coder/reviewer session 且 execution 对齐

动作：

- 自动将 intent 推进到 `claimed`
- 如果 activation 前置条件完整，则进入 `activated`

### 11.6 情况 F：intent 已 activated，但仍只有旧 owner session 在 heartbeat

动作：

- 判定为 `activation_without_target_liveness`
- 回滚 owner 到旧 owner
- intent -> `failed`
- 记录 recoverable incident

---

## 12. 通知与广播

### 12.1 原则

通知不能阻塞 handoff 主流程。

### 12.2 做法

- handoff / milestone 只写 outbox
- Discord 发送异步 drain
- 失败只影响通知，不影响 owner truth

### 12.3 修复当前已知问题

先修：

- `workflow-broadcast-payloads/*.md` 文件名过长导致 `ENAMETOOLONG`

改成：

- `stage-write-<sha12>.md`
- `milestone-<sha12>.md`

不要把长 sessionKey / stage / project id 全拼进文件名。

### 12.4 handoff 消息与 Discord 可见性

不建议简单把所有内部 handoff 改成用户可见消息。

应采用：

- control plane 内部 dispatch 与 claim 走内部 session / runtime surface
- Discord 只收 milestone / stage summary
- handoff detail 放 payload / outbox / `/handoff-status`

这样可以避免：

- Discord 噪音过多
- 内部 handoff 语义泄漏到用户频道
- 把“deliver: true”当成唯一可靠唤醒机制

### 12.5 `/handoff-status` 诊断视图

新增轻量诊断命令，统一展示：

- pending / dispatched / acknowledged / claimed intent
- 每条 intent 的 `deliveryAttempts`
- cooldown / ackDeadline / retryAt
- runtime queue 深度
- mailbox 未 ack 项
- 当前 binding gate 判定

目标是让定位不再散落在多份 JSON 中。

---

## 13. survey 与 research 的差异化接力点

### 13.1 survey 主线

关键 handoff：

1. `survey_review -> write`
   - 必须具备 survey packet
2. `write -> review`
   - 必须具备 writer bootstrap artifacts
3. `review -> submit`
   - 必须具备 review packet 与 citation integrity

### 13.2 research 论文主线

关键 handoff：

1. `idea -> plan`
2. `plan -> code`
3. `code -> experiment`
4. `experiment -> analyze`
5. `analyze -> write`
6. `write -> review`
7. `review -> submit`

### 13.3 差异点

survey 的验收条件更偏：

- coverage
- taxonomy
- SoTA matrix
- gap synthesis

research 的验收条件更偏：

- plan contract
- experiment bundle
- analysis packet
- claim-evidence matrix

协议统一，但 `acceptanceChecks` 不同。

---

## 14. 与现有实现的最小侵入切入点

### 14.1 第一阶段

- 停止在 auto-iterator 里“先改 owner 再 handoff”
- owner 改为由 `activateHandoff(...)` 执行
- `stageHandoff` 壳 intent 删除或并入真实 intent

### 14.2 第二阶段

- 新增 `claimHandoff(...)`
- 新增 `activateHandoff(...)`
- 维护 `pending_handoff_id / current_execution_id`

### 14.3 第三阶段

- 加 handoff reconciler
- 修半交接状态

### 14.4 第四阶段

- 接 milestone outbox / short payload filenames
- 修复 Discord 无消息但 handoff 已发生的问题

### 14.5 第五阶段

- 接 retry sweep / adaptive cooldown / ack watchdog
- 加 session liveness probe
- 补 `/handoff-status`

### 14.6 第六阶段

- 加 stall watchdog
- 对长期 stuck 的 handoff 自动触发 recovery / escalate

---

## 15. 具体要改的代码位置

### 15.1 handoff 核心

- `tools/workflow-handoff/handoff-types.ts`
- `tools/workflow-handoff/handoff-store.ts`
- `tools/workflow-handoff/handoff-delivery.ts`
- `tools/workflow-handoff/maintenance.ts`
- `tools/workflow-handoff/handoff-sweep.ts`
- `tools/workflow-handoff/ack-watchdog.ts`
- `tools/workflow-handoff/dashboard.ts`

### 15.2 stage / auto iterator

- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-guard-collaboration.ts`
- `tools/agent-task-dispatch.ts`

### 15.3 orchestration / manifest

- `tools/workflow-guard-state/execution-state.ts`
- `tools/workflow-guard-setters/research-state-setters.ts`
- `tools/workflow-guard-setters/writing-state-setters.ts`

### 15.4 通知

- `tools/stage-broadcast.ts`
- `tools/workflow-handoff/broadcast-budget.ts`
- `tools/workflow-runtime-state.ts`
- `tools/workflow-runtime-maintenance.ts`

### 15.5 binding / session

- `tools/channel-project-bindings.ts`
- `tools/workflow-runtime-recovery.ts`

---

## 16. 测试策略

### 16.1 必测回归

1. owner 不在 `claimed` 前切换
2. delivery 失败时 owner 回滚
3. pending intent 不会伪装成已交接
4. survey `survey_review -> write` 没有 writer session 时不应切 owner
5. research `plan -> code` 没有 coder claim 时不应切 owner
6. 旧 owner session 存在、目标未 claim 时恢复逻辑可修正
7. broadcast 失败不影响 handoff 激活
8. payload 文件名不会 `ENAMETOOLONG`
9. failed handoff 会被 sweep 再次驱动，而不是永远停在旧状态
10. delivered 但未 claim 的 handoff 会被 watchdog 继续处理
11. 同一项目的 alias binding key 不会造成 handoff 被误拦
12. 不会因为 binding softening 把消息发错频道

### 16.2 真实 E2E

至少覆盖：

- `/auto-review` 到 `survey_review -> write`
- `/auto-research` 到 `idea -> plan -> code`
- 两者都要验证：
  - owner 变化
  - handoff intent 状态变化
  - 目标 session 真存在
  - 通知失败不影响主流程
  - retry sweep 能在前一次失败后把 handoff 接上
  - `/handoff-status` 能解释当前停在哪一步

---

## 17. 风险与兼容性

### 17.1 兼容风险

- 旧项目已有 pending intent 语义会和新状态机冲突
- 旧广播逻辑可能还依赖 `stageHandoff` 壳 intent

### 17.2 缓解

- migration 时把旧 `pending` intent 归类为 `prepared`
- 用 `execution_id` 区分新旧 handoff
- 让 reconciler 优先修旧状态

### 17.3 新增风险

- retry sweep 若无幂等约束，可能重复惊扰同一目标 session
- cooldown/backoff 若设计不当，可能在失败时形成快速抖动
- binding gate 软化若越界，可能重新引入串项目

### 17.4 控制手段

- 所有 retry 绑定 `intentId + executionId + idempotencyKey`
- 只允许 exact-project alias soft match
- 把 session liveness probe 放在 dispatch 前，减少无效 attempt
- user-facing 通知仍严格异步，不参与成功判定

---

## 18. 验收标准

以下全部满足，才算 handoff 真正稳定：

1. 不再出现“manifest owner 已变，但没有目标 session / deliveryAttempts”
2. `handoff_intent.status=pending` 不再被误读成已交接
3. survey `survey_review -> write` 只有在 writer claim 后才切 `owner_agent`
4. research `plan -> code` 只有在 coder claim 后才切 `owner_agent`
5. 广播失败时，handoff 主流程仍然完成
6. heartbeat / maintenance 能自动修复半交接状态
7. Discord 可收到短里程碑消息，但消息失败不会阻塞 workflow
8. failed / delivered-but-unacked handoff 不再长期无 attempt 卡死
9. `/handoff-status` 可以单点解释 handoff 当前阻塞位置
10. binding gate 既不会误拦同项目 alias handoff，也不会放行跨项目 handoff

---

## 19. 实施任务清单

- [ ] 定义 handoff 状态机扩展（prepared / dispatched / claimed / activated）
- [ ] 停止在 auto-iterator 中提前切换 owner
- [ ] 删除或收敛 `stageHandoff` 影子 intent
- [ ] 新增 `claimHandoff` 与 `activateHandoff`
- [ ] 新增 `pending_handoff_id / handoff_phase / current_execution_id`
- [ ] survey / research 分别接入 acceptance checks
- [ ] 实现 handoff reconciler
- [ ] 修 `workflow-broadcast-payloads` 文件名过长问题
- [ ] 新增 milestone outbox
- [ ] 新增 retry sweep
- [ ] 新增 adaptive cooldown / backoff
- [ ] 新增 delivered-but-unacked watchdog
- [ ] 新增 session liveness probe
- [ ] 新增 `/handoff-status`
- [ ] 新增 stall watchdog
- [ ] 增加 E2E 与恢复回归测试
