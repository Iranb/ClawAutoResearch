# Workflow 避免依赖 Plugin Runtime Subagent 的设计稿

**状态：** 草稿  
**日期：** 2026-04-02  
**作者：** Codex  
**范围：** `openclaw-research` workflow、slash commands、PaperNexus / literature / review wrapper 路径、agent 文档约束

---

## 1. 背景

当前 `openclaw-research` 的自动化 workflow 运行在 `openclaw` 插件 runtime 之上。

已知上游存在一个真实缺陷：

- plugin tool 在普通 chat / agent 执行路径中，可能拿到的是 unavailable `runtime.subagent`
- 结果是在工具“可见、可调用”的情况下，深层执行时才报：
  `Plugin runtime subagent methods are only available during a gateway request.`

对应讨论见：

- `openclaw/openclaw` issue `#50131`

从当前代码和 issue 讨论综合看，问题不只是单一工具 bug，而是一个“执行上下文不稳定”的系统性边界：

1. 有些路径会显式传递 `runtimeOptions` / `allowGatewaySubagentBinding`
2. 有些路径不会
3. 即使传了，也仍然依赖 gateway request scope 或 fallback gateway context 是否可用

因此，在 `openclaw` upstream 完成根修复前，`openclaw-research` 不能把关键 workflow 建立在“plugin tool 内部再去调用 `runtime.subagent.*`”这条路径上。

---

## 2. 设计目标

本设计的目标不是修复 `openclaw` upstream 本体，而是让 `openclaw-research`：

1. **尽量避免**在关键 workflow 上触发 `Plugin runtime subagent methods are only available during a gateway request`
2. 即使底层 runtime 不可用，也能：
   - 显式排队
   - 显式记录
   - 显式恢复
   - 不让前台沟通静默卡死
3. 把“真正调度 agent”的职责尽量从 plugin tool 内部，提升到 workflow 自己的 durable orchestration 层
4. 保留以下能力：
   - PaperNexus wrapper-first 流程
   - persistent runtime queue / broadcast / announce
   - slash command 入口
   - aggressive auto mode 的自动推进

一句话概括：

**在不依赖 upstream 立即修复的前提下，把 `openclaw-research` 的关键执行路径改造成“workflow-owned dispatch first，plugin runtime subagent only as opportunistic acceleration”。**

---

## 3. 非目标

本设计不做以下事情：

1. 不直接重写 `openclaw` 本体
2. 不移除所有 subagent 机制
3. 不禁用普通 OpenClaw agent / sessions / workflow orchestrator
4. 不要求所有 plugin tool 完全不能使用 `runtime.subagent`
5. 不推翻现有 project state files、manifest、runtime queue、announce outbox 体系

---

## 4. 核心结论

### 4.1 不能“一刀切禁用 subagents”

当前 `openclaw-research` 很多自动化能力本身就依赖 workflow-owned subagent/session orchestration：

- background workflow run
- PaperNexus wrapper continuation
- gate review / discussion reviewer
- runtime queue replay

这些不是问题根源，不能一起停掉。

### 4.2 真正该避免的是“plugin tool 内部 delegated subagent 作为关键主路径”

以下形态当前应视为高风险：

- tool 可见
- tool 入口在 plugin runtime 中执行
- tool 内部直接依赖 `runtime.subagent.run(...)`
- 失败时没有 durable queue / explicit fallback

### 4.3 关键 workflow 必须改成 workflow-owned dispatch

对于会影响 stage 推进的关键环节，应该优先使用：

- `research_workflow.*` durable tool
- workflow session orchestrator
- background workflow queue
- wrapper-first continuation

而不是让插件工具在内部自行决定再起 delegated subagent。

---

## 5. 风险分层

### 5.1 允许继续依赖的路径

以下路径可以继续使用 subagent / background session：

1. workflow runtime 自己创建并记录的 background session
2. `sessions_spawn` / orchestrator 控制的 child session
3. announce-first 的 nested reviewer / discussion worker
4. 明确有 durable queue / replay / `needs_repair` 语义的后台 continuation

这些路径的特点是：

- 有持久化状态
- 有 fallback
- 有广播
- 失败不会让用户只看到一条深层 runtime 错误

### 5.2 需要降级为“可选增强”的路径

以下路径不应再作为关键主路径：

1. plugin tool 内部的 delegated expansion / helper run
2. plugin tool 内部的 typed research brief 再分发
3. plugin tool 内部的 ad-hoc subagent fan-out

这些路径如果要保留，只能作为：

- best-effort enhancement
- bounded optional step
- failure-safe helper

### 5.3 必须禁入关键路径的场景

以下场景不能再把 plugin runtime subagent 作为 hard dependency：

1. `/research-pipeline`
2. `/research-queue`
3. `/resume-pipeline`
4. `paper ingestion` / `graph refresh` / `brainstorm refresh`
5. stage handoff
6. auto mitigation
7. code-review gate
8. experiment monitor 到 analyze 的切换

---

## 6. 新的执行原则

### 6.1 Workflow-owned dispatch first

关键动作统一由 `research_workflow.*` 或 runtime orchestrator 发起。

这意味着：

- tool 负责描述动作
- workflow 负责调度 agent
- plugin tool 不再承担关键调度权

### 6.2 Queue-first for slash commands

所有关键 slash command 都要默认支持：

1. 若 gateway-bound runtime 可用，立即启动
2. 若不可用，立刻 durable queue
3. 回复用户“已排队 + 原因 + 下次 replay 条件”
4. 后续命令或 coordinator tick 自动 replay

这条原则已经部分落实在：

- `/research-pipeline`
- `/research-queue`
- `/resume-pipeline`

后续需要继续加强一致性。

### 6.3 Wrapper-first for PaperNexus and research helpers

PaperNexus、literature、brainstorm、graph status 等关键动作，统一走：

- Python wrapper
- workflow-owned background continuation
- `set_paper_ingestion` / durable state
- channel-visible progress

而不是依赖子 agent 自由文本回复。

### 6.4 Announce-first for nested work

如果必须使用 nested child worker，则：

1. child 只负责产出 announce payload
2. parent / coordinator 负责综合
3. channel 只看 parent 的 durable synthesis

不要让 plugin tool 自己兼任：

- spawn child
- wait child
- synthesize child
- directly reply channel

---

## 7. 对现有 workflow 的具体约束

### 7.1 `/research-pipeline`

目标：

- 保持可从 Discord 启动
- 保持 background 模式
- 不因为 runtime.subagent 缺失直接报错

约束：

1. 命令入口必须 queue-first
2. 真实 PaperNexus 上传、batch import、graph readiness、brainstorm refresh 由 workflow continuation 执行
3. plugin tool 不直接承担主调度

### 7.2 `/research-queue`

目标：

- 成为显式的后台队列可视化入口

约束：

1. 只展示 workflow runtime queue / background sessions / announce 状态
2. 不隐式创建依赖 plugin subagent 的新动作

### 7.3 `/resume-pipeline`

目标：

- 保证 resume 语义稳定

约束：

1. resume 先查 durable runtime state
2. 若 runtime 不可用，继续 queue
3. 不允许 resume 内部绕过 workflow runtime，直接依赖 plugin tool subagent

### 7.4 `/workflow-status`

目标：

- 成为事实源入口，而不是“顺手触发高风险 delegated work”

约束：

1. 只做状态汇总
2. 最多 opportunistic replay queue
3. 不直接承担深层 delegated plugin tool orchestration

---

## 8. 对 plugin tool 的新分类

### 8.1 A 类：关键路径禁止直接 delegated subagent

这类 tool 只能：

- 产生命令意图
- 写 durable state
- 调用 workflow-owned queue

例如：

- PaperNexus wrapper launch
- experiment monitor launch
- review round launch

### 8.2 B 类：可选增强工具

这类 tool 可以内部用 subagent，但必须满足：

1. 失败不影响 stage 前进
2. 失败时可降级为同步/简单实现
3. 失败时不会只向用户暴露底层 gateway request 错误

### 8.3 C 类：纯只读工具

这类工具不应依赖 delegated subagent：

- query
- status
- catalog
- inventory
- rendering helper

---

## 9. 建议新增的 guard / contract

### 9.1 Runtime capability contract

新增一个 workflow 内部概念：

- `plugin_subagent_runtime_contract`

可取值：

- `guaranteed`
- `best_effort`
- `forbidden_for_critical_path`

对当前 `openclaw-research`，默认应视为：

- 对关键路径：`forbidden_for_critical_path`
- 对可选增强：`best_effort`

### 9.2 Tool metadata contract

对会调起 plugin tool 的 workflow 入口，要显式标注：

- 是否 critical
- 是否允许 delegated subagent
- 失败是否允许 queue fallback
- 是否必须有 channel progress path

### 9.3 Prompt contract

Researcher / Reviewer / Coder / Orchestrator 文档需明确：

1. 不要把 plugin tool 内部 subagent 当成可靠主执行面
2. 关键任务优先调用 `research_workflow.*`
3. 需要后台执行时优先 workflow-owned queue / orchestrator
4. plugin tool 的 delegated subagent 只作为增强，不作为 hard dependency

---

## 10. Fallback 设计

### 10.1 Runtime unavailable

当出现：

- `Plugin runtime subagent methods are only available during a gateway request.`
- `no_runtime_subagent`
- 无 gateway scope

统一 fallback：

1. durable queue
2. 记录 cause
3. 广播 queued 状态
4. 后续命令或 coordinator replay

### 10.2 Plugin tool enhancement unavailable

当增强型 plugin tool 内部 delegated work 失败时：

1. 降级成本地同步版本或较弱实现
2. 若无法降级，返回结构化 warning
3. 不把 stage 卡在纯 enhancement 上

### 10.3 Critical path launch unavailable

若关键路径动作无法立即执行：

1. 绝不静默失败
2. 绝不只留下深层 runtime 错误
3. 必须：
   - queued
   - blocked
   - needs_repair
   三者之一

---

## 11. 对文档和技能的影响

需要统一修改：

1. `WORKFLOW.md`
2. `tools/workflow-guard.ts` 中的 prompt / status wording
3. `agents/*/AGENTS.md`
4. `agents/*/SOUL.md`
5. `skills/researcher/*`
6. `skills/reviewer/*`
7. `skills/coder/*`
8. slash command 文档

重点是把以下口径写清楚：

- background workflow 由 workflow 自己调度
- plugin delegated subagent 不是关键主路径
- 关键任务必须有 durable progress path

---

## 12. 验收标准

满足以下条件时，认为该设计落地成功：

1. `/research-pipeline`、`/research-queue`、`/resume-pipeline`、`/workflow-status` 不再因为 plugin runtime subagent 缺失而直接把关键路径打断
2. PaperNexus / graph / brainstorm / monitor / review 等关键流程不再把 plugin delegated subagent 当 hard dependency
3. channel 用户看到的是：
   - queued
   - started
   - replayed
   - blocked
   - needs_repair
   这些明确状态，而不是深层 runtime stub 报错
4. agent 文档明确禁止把关键 workflow 建在 plugin runtime delegated subagent 上
5. 即使 upstream `openclaw` 未修复，该 workflow 仍能继续推进到人工 `submit` gate

---

## 13. 推荐决策

在 `openclaw` upstream 根修复合并前，`openclaw-research` 应采取以下总策略：

1. **继续使用 workflow-owned sessions / subagent / orchestrator**
2. **避免关键路径依赖 plugin runtime delegated subagent**
3. **所有关键 slash command 都走 queue-first**
4. **所有关键后台工作都必须有 durable state + replay**
5. **把 plugin runtime subagent 降级为增强能力，而不是关键 contract**

这是在当前条件下，最能稳定推进自动化科研 workflow，同时又尽量不被 `gateway request` 语义绊倒的方案。
