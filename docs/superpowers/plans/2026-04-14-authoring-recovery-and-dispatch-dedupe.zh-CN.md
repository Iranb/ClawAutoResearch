# Authoring Recovery Mirror 与 Writer Handoff 去重重构方案

**状态：** implemented  
**日期：** 2026-04-14  
**目标：** 解决 survey/review 项目里 writer 反复被拉起、`academic_writer/paper` 丢失后只能全量重建、以及 handoff 已满足却仍继续 spawn fallback 的控制面混乱。

## 问题画像

当前异常不是单点 bug，而是两条链路叠加：

1. **Authoring artifacts 缺少 workflow-owned recovery layer**
   - `academic_writer/paper/` 一旦丢失，新的 writer session 只能依赖当前磁盘是否存在 `paper/sections/`
   - 若目录消失，writer 会直接进入 “full rebuild” 分支
   - `writing_session` 本身也可能在 session boundary 后变空，进一步放大重建行为

2. **writer handoff delivery 缺少已有 owner/session 的去重保护**
   - 当前 owner 已是 `academic_writer`
   - 且已有 active writer session
   - 但 handoff delivery 若没拿到它定义的 acceptance，仍可能走到 `spawn_fallback`
   - 造成 `/sessions` 里不断出现新的 writer

## 设计原则

1. 不靠补丁兜底，要把 **artifact recovery** 和 **dispatch ownership** 变成控制面能力
2. 不要求 writer 每次都重新推断真实状态，要给它 durable recovery substrate
3. 不允许同项目同阶段在 owner 已经满足时继续重复 spawn 新 writer
4. 自动恢复优先于自动重写；能 restore 就不要 rebuild

## 实施项

### 1. Authoring recovery mirror

新增 workflow-owned recovery 模块：

- 记录并镜像这些关键产物：
  - `academic_writer/PAPER_PLAN.md`
  - `academic_writer/STORYLINE_SKETCH.md`
  - `academic_writer/WRITING_SIGNALS.md`
  - `academic_writer/paper/main.tex`
  - `academic_writer/paper/refs.bib`
  - `academic_writer/paper/main.pdf`
  - `academic_writer/paper/sections/*.tex`
- 产物镜像保存到：
  - `{PROJ}/.openclaw-research/authoring-recovery-mirror/`
- receipt 保存到：
  - `{PROJ}/.openclaw-research/authoring-artifact-receipts.json`

### 2. Recovery-first writer state

当 `get_snapshot` / `get_writing_session` / `materialize_writing_support_artifacts` 发现：

- 当前 `writing_session` 为空或接近空
- 但 recovery mirror 有已知 draft 资产

则：

1. 先恢复缺失文件
2. 用 receipt 中的 writing session snapshot 重新水合 `writing_session`
3. 只有 mirror 也没有时，才进入 `rebuild_needed`

### 3. Dispatch dedupe

在 `dispatchWorkflowTaskToAgent` 里新增 preflight：

- 若目标 role 已是 manifest 当前 owner
- 且该项目已有 active target session
- 则认为该 handoff **already active**
- 直接复用现有 session，不再创建 mailbox 重复消息，也不再进入 `spawn_fallback`

### 4. Handoff delivery respect existing owner

在 handoff delivery 路径里：

- 若 control plane 已满足 `owner=current_owner=targetRole`
- 且 runtime store 也有 active target session
- 则将 intent 直接推进到可分发/已分发状态
- 不再走 runtime queue 的重复补发

### 5. Activated handoff queue reconciliation

当 handoff intent 已经 `claimed` / `activated` 后：

- 所有 `queueKey = handoff:<intentId>` 的 runtime queue entry 必须标记为 `completed`
- 如果 queue entry 已经是 `degraded`，也要被 activation reconciliation 收敛为 `completed`
- dashboard / runtime health 不应再出现“handoff 已成功但 queue degraded”

### 6. Spawn fallback delay

native delivery 不应在目标主 session 可派生时直接创建随机 `agent:<role>:subagent:<uuid>`：

- 先尝试 canonical role session
- 若已有 project-local registry session，直接复用
- 只有没有任何可用目标 session，且 dispatch 明确失败，才允许 spawn fallback

## 验收标准

1. `academic_writer/paper` 缺失但 recovery mirror 存在时，可自动恢复
2. `writing_session` 丢失时，可从 recovery receipt 恢复而不是直接 full rebuild
3. 当前 owner 已经是 writer 且 writer session 仍 active 时，不再 spawn 新 writer
4. 同项目 write 阶段不会因为重复 handoff delivery 在 `/sessions` 中膨胀
5. 已激活 handoff 不再留下 degraded runtime queue
6. 相关 runtime / handoff / writer recovery 回归测试通过
