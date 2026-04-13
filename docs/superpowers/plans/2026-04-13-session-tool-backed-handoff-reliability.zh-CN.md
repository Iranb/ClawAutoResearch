# Workflow Handoff 与 OpenClaw Session Tool 融合优化方案

**状态：** proposed  
**日期：** 2026-04-13  
**目标：** 基于 OpenClaw 官方 `sessions_send` / `sessions_spawn` / `sessions_yield` 能力边界，补强当前 workflow handoff 的控制面与投递面，使跨 owner 接力既保持原子性，又能在真实 Discord / gateway 运行时更稳定地把任务交到下一个 agent。

---

## 1. 背景

当前 handoff 已经完成了第一轮原子化重构：

- 跨 owner 不再应直接切 `owner_agent`
- workflow 需要先创建真实 handoff intent
- 目标 role claim 后才允许 activate

但真实运行仍暴露出几类问题：

1. `survey_review -> write` 已经被判定 ready，但 writer 没有真正被唤醒
2. handoff intent 有时出现：
   - `prepared`
   - `superseded`
   - `binding_gate_mismatch`
   - 但没有对应 writer session
3. 有时 manifest / orchestration 已经显示：
   - `stage = write`
   - `owner = academic_writer`
   但 handoff store / runtime session 不能证明 writer 真接手了
4. 不同 session 树、不同 binding key 形态、以及 plugin runtime / gateway runtime 的能力差异，会影响 handoff 的可靠性

因此，下一步不能只继续修内部状态机，还需要把 **OpenClaw 官方 session tool** 正式纳入 handoff delivery 设计。

---

## 2. 官方 Session Tool 结论

基于官方文档与源码，重要结论如下。

### 2.1 `sessions_send`

职责：

- 向另一个**已存在的 session** 发送消息
- 适合作为 handoff 的首选投递面

适合：

- 已知目标 role 的 canonical session key
- 已有目标 session 存在，且只需要唤醒 / 投递任务

不负责：

- 创建新 agent session

### 2.2 `sessions_spawn`

职责：

- 启动新的 sub-agent / child session
- 是 handoff 的第二优先级投递面

适合：

- 目标 role 当前没有可用 session
- 需要显式拉起一个新的 writer / reviewer / analyzer lane

不负责：

- 自动更新 workflow owner truth

### 2.3 `sessions_yield`

职责：

- 结束当前 turn
- 让当前 session 在下一轮接收后续结果

不适合：

- 拉起新的 agent
- 直接做 handoff delivery

它只能作为：

- 当前 turn 的 clean stop signal
- 等待子任务 / follow-up 的 turn control 工具

### 2.4 深度与权限限制

OpenClaw 官方文档明确指出：

- 默认 leaf subagent 没有 session tools
- depth-1 orchestrator 才可能拿到更完整的 session control 能力
- 因此不能假设任意 workflow leaf session 都能直接 `sessions_send` 或 `sessions_spawn`

这意味着：

- **handoff 的 session-tool 调用必须尽量收敛在 workflow control plane / privileged runtime surface**
- 不能把“session tool 调用权”随意下放给每个 leaf worker

---

## 3. 当前 Bug 的根因拆解

### 3.1 伪 handoff

症状：

- `stageAfter = write`
- `ownerAfter = academic_writer`
- 但没有 writer session / 没有真实 handoff intent / 没有 claim

根因：

- auto-iterator 发现下一阶段属于另一个 owner
- 但 delivery 与 activate 没有完全绑定
- 或没有通过真实 session-tool / runtime dispatch 建立目标接力

### 3.2 影子 intent / 脏 intent

症状：

- 先有一条 `binding_gate_mismatch` / `superseded` 的 intent
- 后面又有另一条成功的 intent

根因：

- 准备态 intent 和投递态 intent 没完全共用一条控制面链路
- 或同一个转移在不同 runtime context 下被重复建 intent

### 3.3 目标 session 不存在或不可见

症状：

- writer 应该接手
- 但 runtime 中没有 writer session
- 或只有 researcher session 还在

根因：

- 只有 `sessions_send`，没有 `sessions_spawn`
- 或当前请求上下文没有 session tools 权限
- 或叶子 session 本身无权发 cross-session 消息

### 3.4 claim 与 activate 没完全闭环

症状：

- 有 runtime 里的 writer session
- 但 handoff store 不完整 / manifest owner 仍乱跳

根因：

- 目标 session 收到任务后，没有统一的 claim 协议
- claim 与 activate 没有一条单一事实源

---

## 4. 设计原则

1. **workflow control plane 持有 owner truth**
2. **session tools 只负责投递，不负责 owner 切换**
3. **`sessions_send` 优先，`sessions_spawn` 兜底**
4. **`sessions_yield` 只用于当前 turn clean stop，不用于拉起别的 agent**
5. **跨 owner 永远先 prepared / dispatched，再 claim / activate**
6. **同一个 handoff 只有一个 intent id / execution id**
7. **binding gate 仍然保守，不因 session tool 引入串项目**

---

## 5. 最稳的 Handoff 架构

### 5.1 控制面

workflow control plane 负责：

- 判断当前阶段是否 ready to handoff
- 创建唯一 handoff intent
- 写入 `pending_handoff_id`
- 记录 `pending_owner_candidate`
- 执行 delivery
- 等待 claim
- claim 后 activate
- 失败后 retry / fallback / supersede / rollback

### 5.2 投递面

delivery 顺序：

1. **`sessions_send`**
   - 如果 canonical target session 已存在
2. **`sessions_spawn`**
   - 如果目标 role session 不存在，或 `sessions_send` 明确失败
3. **runtime queue**
   - 当当前 turn 没有 session-tool runtime 权限时，持久化等待下一次可投递窗口
4. **mailbox / broadcast**
   - 只做兼容 / 通知，不再当成 owner handoff 的主路径

### 5.3 执行面

目标 agent 负责：

- 收到 session message
- 读取 mailbox / handoff packet
- 调 `claim_handoff_intent`
- 继续工作

claim 成功前：

- manifest 不切 owner

claim 成功后：

- workflow 才 activate

---

## 6. `prepare_stage_handoff` 的正式角色

新增或强化统一动作：

- `research_workflow.prepare_stage_handoff`

它必须成为：

- researcher / orchestrator / coder / analyzer / reviewer / academic_writer
  所有跨 owner 交接的标准出口

### 6.1 输入

- `stageAfter`
- `toRole`
- `summary`
- `command`
- `acceptanceChecks`
- `dispatch: true|false`

### 6.2 输出

- 唯一 handoff intent
- `prepared` / `dispatched` / `queued` 等状态
- `pending_handoff_id`
- 当前是否已经成功投递

### 6.3 规则

- 不允许它直接改 `owner_agent`
- 不允许它跳过 handoff store
- 不允许 role skill 自己发裸 Discord handoff 消息替代它

---

## 7. Shared Skill 方案

新增：

- `skills/shared/workflow-handoff-signal/SKILL.md`

并挂到各主要角色 skill index 中。

### 7.1 skill 目标

统一告诉各 agent：

- 阶段完成后先 reconcile durable state
- 再调用 `prepare_stage_handoff`
- 然后停止，不自己切 owner，不自己代替下一位继续干活

### 7.2 角色差异

差异只体现在 `acceptanceChecks`：

- survey `survey_review -> write`
- plan `plan -> code`
- code `code -> experiment`
- analyze `analyze -> review`
- review `review -> write`
- write `write -> submit`

协议统一，不再每个角色各玩一套。

---

## 8. 具体代码改造

### 8.1 auto-iterator

文件：

- `tools/workflow-guard-runtime/auto-iterator.ts`

要求：

- 检测到跨 owner transition 时：
  - `result.stageAfter` 仍可为下一个阶段
  - 但 manifest 保持旧 owner / 旧 stage
  - 同时自动 materialize `prepared` handoff intent
- 不允许再出现：
  - `stageAfter = write`
  - manifest 直接被写成 `write/academic_writer`
  - 却没有 handoff intent

### 8.2 register-workflow-tools

文件：

- `tools/register-workflow-tools.ts`

要求：

- `prepare_stage_handoff` 成为正式 action
- `claim_handoff_intent` 允许从 `prepared/dispatched/queued` 进入 claim
- cross-owner auto-stage dispatch 统一使用共享 delivery runtime builder
- 不再让“显式 tick”和“prepare handoff”各走一套逻辑

### 8.3 handoff store / activation

文件：

- `tools/workflow-handoff/handoff-store.ts`
- `tools/workflow-handoff/handoff-activation.ts`

要求：

- 同一 `executionId` 的 intent 允许 enrich，不重复造脏 intent
- `claimAndActivateWorkflowHandoffForAgent` 成为目标 session 的标准 claim 入口
- prepared / dispatched / claimed / activated 语义固定

### 8.4 session-tool-backed delivery adapter

新增或重构：

- 可在 workflow control plane 内部优先走 `sessions_send`
- `sessions_send` 不可用时再走 `sessions_spawn`
- 再不行才 runtime queue

注意：

- 这层必须运行在有 session tools 权限的 runtime context 中
- 不能依赖 leaf worker 自己拥有 session tools

### 8.5 writer / reviewer / analyzer runtime discovery

为每个 role 建 canonical target resolution：

- `agent:<role>:discord:channel:<channelId>`
- 如果存在 thread-bound / subagent-bound canonical lane，也要优先解析

不允许：

- 因为当前会话是 researcher，就把 writer task 发回 researcher tree

---

## 9. 当前 bug 的专项修复项

### 9.1 survey_review -> write 假 handoff

修复目标：

- auto-iterator 只能产生 `prepared` handoff
- 没有 writer claim 之前：
  - manifest 仍保持 `survey_review/researcher`
- 只有 claim 后：
  - 进入 `write/academic_writer`

### 9.2 handoff intent 丢失

修复目标：

- 任何跨 owner transition 都必须落真实 `workflow-handoff-intents.json`
- 不允许 manifest 已经变了，但 handoff store 还是空

### 9.3 writer session 未起

修复目标：

- 如果 `sessions_send` 找不到 writer session
- control plane 必须尝试 `sessions_spawn`
- 仍失败时才转 queue

### 9.4 binding mismatch 伪 supersede

修复目标：

- prepared intent 创建时也要携带正确 session binding context
- 不要先创建无 binding 的 intent，再让它被 supersede

---

## 10. Phase Rollout

### Phase A：堵住伪 handoff

- auto-iterator 不再直接切 manifest owner/stage
- prepared intent 自动 materialize

### Phase B：正式引入 `prepare_stage_handoff`

- role skills 改为统一协议
- 手工/自动 handoff 都走这个 action

### Phase C：session-tool-backed delivery

- `sessions_send` 优先
- `sessions_spawn` 兜底
- runtime queue 只做耐久等待

### Phase D：claim / activate 闭环

- 目标 session 收到任务后统一 claim
- claim 后 activate
- writer / reviewer / analyzer 都走同一协议

### Phase E：清理脏 intent / 双轨现象

- 同 execution id enrich，不重复建 intent
- 消灭 “superseded + activated 双轨并存” 这种噪音

---

## 11. 验证策略

### 11.1 单元 / 集成

必须新增或更新测试：

1. `prepare_stage_handoff` 创建真实 prepared intent 且不切 owner
2. auto-iterator 跨 owner 只创建 prepared intent，不直接切 manifest
3. `claim_handoff_intent` 允许从 `prepared/dispatched/queued` claim
4. `sessions_send` 成功时不走 spawn
5. `sessions_send` 失败时 fallback 到 `sessions_spawn`
6. `sessions_spawn` 失败时 fallback 到 runtime queue
7. 同一 execution id 不会重复造两条 active intent
8. survey `survey_review -> write` 没有 writer claim 前，manifest 不能是 `write/academic_writer`
9. writer claim 后，manifest 才进入 `write/academic_writer`

### 11.2 真实验证

至少覆盖：

- `/auto-review`：`survey_review -> write`
- `/auto-research`：`plan -> code`
- `analyze -> review`
- `review -> write`

每条都要验证：

- handoff store 是否存在
- runtime session 是否真的出现
- owner 是否只在 claim 后切换
- 没有 “manifest 已切、intent 不存在” 的假 handoff

---

## 12. 验收标准

以下全部满足才算完成：

1. `stageAfter = write` 不再直接导致 manifest 进入 `write/academic_writer`
2. 所有跨 owner transition 都有真实 handoff intent
3. `prepare_stage_handoff` 成为统一出口
4. 角色 skill 不再引导直接 Lobster handoff
5. `sessions_send` / `sessions_spawn` 被正式用于 handoff delivery
6. `sessions_yield` 未被误用为 spawn / handoff tool
7. writer / reviewer / analyzer 的真实 session 可以被稳定拉起或命中
8. claim 后才 activate
9. 不再出现“superseded 的脏 intent + 成功 intent”双轨噪音主导现场

---

## 13. 当前建议的落地顺序

最稳的顺序：

1. **先修 auto-iterator 跨 owner 直接切 manifest**
2. **再上 `prepare_stage_handoff`**
3. **再把 delivery 切到 session tools 优先**
4. **最后统一 role skills**

原因：

- 先有 control-plane 真相
- 再有投递
- 再让 skill 使用它

这样不会把新的 session-tool 投递接到旧的伪 handoff 语义上。
