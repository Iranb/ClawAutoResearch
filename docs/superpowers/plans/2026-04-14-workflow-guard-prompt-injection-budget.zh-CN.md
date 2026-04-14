# Workflow Guard Prompt 注入预算与 Reviewer Main 上下文保护方案

**状态：** implemented  
**日期：** 2026-04-14  
**目标：** 防止 `agent:reviewer:main` 这类长期复用 session 因反复收到完整 `[Workflow Guard]` 控制块而超过基座模型上下文长度。

## 1. 事故现象

`agent:reviewer:main` 对应 transcript 中出现：

- `[Workflow Guard]` 216 次
- `Owner=unset` 87 次
- `Stage=unknown/unknown` 62 次
- 大量 `NO_REPLY`

这说明 reviewer 并不是在执行 216 个真实审稿任务，而是被 boot / heartbeat / 空上下文检查反复注入完整 Workflow Guard。

## 2. 根因

当前 `before_prompt_build` hook 在这些场景也会注入完整 guard：

- 没有绑定项目
- `Stage=unknown/unknown`
- `Owner=unset`
- 没有 mailbox / handoff / explicit slash command
- 最新 prompt 本身已经是上一次注入的 `[Workflow Guard]`

长期复用的 `agent:reviewer:main` 因此不断累积重复控制块，最终超出模型上下文。

## 3. 稳定修复原则

1. **空上下文不注入**
   - 没项目、没任务、没 slash fast-path 时不要注入完整 Workflow Guard

2. **heartbeat 只处理 delta**
   - heartbeat 没有新任务、新 handoff、新 stage 变化时跳过注入

3. **session-level fingerprint 去重**
   - 同一 session、同一项目、同一 stage/owner、同一 blocker 状态不重复注入全文

4. **项目任务不再滥用 main session**
   - 项目任务由 `{PROJ}/.openclaw-research/workflow-agent-sessions.json` 记录的 role session 承载
   - main session 只承载轻量 boot / no-op

## 4. 实施项

### 4.1 Hook 空上下文跳过

在 `tools/register-workflow-hooks.ts` 中：

- 若 `snapshot.projectRoot` 为空
- 且最新 prompt 不是明确 workflow slash command
- 且没有 heartbeat-claimed task
- 则直接 `return undefined`

### 4.2 Guard echo 跳过

如果最新 prompt 已经包含 `[Workflow Guard]`，且没有新项目上下文或真实任务，则不再注入。

### 4.3 Prompt fingerprint cache

新增进程内去重 cache：

- key: `sessionKey`
- value: `projectId + stage + owner + role + trigger + blocker/missing signal summary`

重复时：

- heartbeat: 直接跳过
- guard echo: 直接跳过

### 4.4 Tests

新增/更新测试：

- workflow agent 在无项目、无任务时不注入 guard
- workflow agent 有项目时仍注入 guard
- heartbeat 重复 fingerprint 不重复注入

## 5. 验收标准

1. `agent:reviewer:main` 不再在无项目 boot/no-op 场景累积完整 guard
2. 有项目、有 handoff、有 slash fast-path 时仍保留必要 workflow context
3. 同一 session 的 heartbeat 不再重复注入同一份 guard
4. prompt hook 相关回归通过
