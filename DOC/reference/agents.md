# Agent 角色与目录配置

## 1. 总览

当前 `agents/` 下包含 7 个主要角色：

| Role | 主要职责 |
| --- | --- |
| `researcher` | 项目 owner、阶段协调、文献、Zotero 文献管理、图谱、创新、graph-first ideation contract、`research-ideation` / `idea-tournament` 收敛、实验总账、恢复与自动迭代 |
| `orchestrator` | 研究计划、实验排期、风险、预算和 TODO 编排 |
| `coder` | 实验代码实现、运行脚本、复现实验、工程侧 smoke test、实现阶段科研绘图，并对齐 proposal / claim-to-experiment contract |
| `analyzer` | 结果解释、图表、claim-evidence、PaperNexus 反思，并把 claim support / track verdict / unsupported-claim hooks 回写到 durable `paper_story_state` |
| `academic_writer` | 论文大纲、模版映射、Zotero 引用队列、workflow-owned durable paper story contract、段落逻辑、正文写作与编译 |
| `reviewer` | review phase、`paper-review` 对抗式自审、critical thinking、scholar evaluation、workflow-owned durable review pressure packet、submission packet、review response |
| `cross-reviewer` | 隔离式外部视角审阅，不持有主动项目写权限 |

## 2. 每个 Agent 目录中的配置文件

当前每个角色目录下都保留了官方风格的配置分层：

- `AGENTS.md`  
  角色总说明，连接 lifecycle、workflow、通信和主要技能。

- `IDENTITY.md`  
  角色身份、人格、风格、名字等。

- `SOUL.md`  
  角色长期价值观和行为底色。

- `TOOLS.md`  
  角色常用工具、工具使用边界和环境说明。

- `BOOT.md`  
  每次唤醒时的即时行为规则。

- `BOOTSTRAP.md`  
  首次启动或恢复时必须先做什么。

- `HEARTBEAT.md`  
  心跳轮次下的默认行为，尤其是自动迭代与空闲任务。

其中：

- `researcher/` 额外包含 `SERVER.md`

## 3. workflow guard 中的角色权限

插件层并不是把所有 Agent 都当成平级实体，而是有显式角色策略。

### `researcher`

- 可联系：所有主 Agent
- 可派生：所有主 Agent
- 允许写：
  - `{PROJ}/PROJECT_MANIFEST.json`
  - `{PROJ}/TRACK_REGISTRY.json`
  - `{PROJ}/CLAIM_POLICY.md`
  - `{PROJ}/README.md`
  - `{PROJ}/researcher/`
  - `{PROJ}/graph/`
  - `{PROJ}/memory/`
  - `{PROJ}/reviewer/`
  - `{PROJ}/cross-reviewer/`
  - `{PROJECTS_ROOT}/PROJECTS_STATE.json`

### `orchestrator`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/orchestrator/`

### `coder`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/coder/`
- 例外：可 append `orchestrator/TODOS.md`
- 数据集边界：只读，不能对共享 `datasets/` 根目录做原地修改

### `analyzer`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/analyzer/`
- 例外：可 append `orchestrator/TODOS.md`

### `academic_writer`

- 可联系：`researcher`、`cross-reviewer`
- 可派生：无
- 主要写入：`{PROJ}/academic_writer/`
- 例外：可 append `orchestrator/TODOS.md`

### `reviewer`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/reviewer/`

### `cross-reviewer`

- 可联系：无
- 可派生：无
- 项目写权限：无

## 4. Agent 间通信与完成交接

当前系统不把原始 `@agent` mention 当作普通聊天装饰，而是把它当作“需要立刻唤醒下一位 owner”的控制信号。

推荐的真实路由路径仍然是：

- `sessions_send`
- `sessions_spawn`
- `research_workflow.send_mailbox`

### 4.1 完成交接的标准模板

每次角色完成一个 stage 或一个可交接的子任务时，优先使用下面的 channel 消息结构：

```text
[STATUS] <stage-or-task> complete
[HANDOFF] next owner: <role>
[ARTIFACTS] <what was produced or where it lives>
[NEXT] <what the next agent should do immediately>
[@<role>] only if an immediate wake-up is required
```

最重要的约束是：

- `@<role>` 只在“需要马上唤醒下一位 agent”时出现
- 每条完成交接消息最多出现一次原始 `@`
- 如果只是播报进度、同步状态、或等待人类确认，不要 `@`
- 如果下一位 owner 已经在同一线程里出现过，就不要重复 `@`
- 如果 next owner 是当前 agent 自己，也不要 `@`，只写自交接说明

### 4.2 回复时的 anti-duplicate-@ 规则

收到别人的 handoff 后，回复应当：

- 用 plain text 先确认状态，例如 `ACK`、`收到`、`I’ll take this next`
- 直接写角色名，不要再次复制原始 `@agent`
- 只有在“新的唤醒动作”确实需要再次触发时，才重新发送一次原始 `@`
- 不要在同一串回复里把相同的 `@agent` 重复写进确认句、总结句和下一步句

### 4.3 按角色的 completion handoff 模板

- `researcher` 完成 `graph_build` / `frontier_mapping` / `idea` 后，常见模板是把计划交给 `@orchestrator`。
- `orchestrator` 完成 `PLAN.md` 和 `TODOS.md` 后，常见模板是把执行交给 `@coder`。
- `coder` 完成实现包后，常见模板是把可运行结果交回 `@researcher`。
- `analyzer` 完成分析包后，常见模板是把可写作的结论交给 `@academic_writer`。
- `academic_writer` 完成草稿后，常见模板是把稿件交给 `@reviewer`；若做外部视角预审，则交给 `@cross-reviewer`。
- `reviewer` 完成 review 后，常见模板是把结论交回 `@researcher`。
- `cross-reviewer` 完成单次 review 后，直接返回给调用方，不需要在公共频道里重复 mention。

## 5. Agent 的空闲行为

不同 Agent 的 heartbeat / idle 轮次不是“自由发挥”，而是 bounded background tasks。

例如：

- `researcher`  
  文献跟踪、Zotero `bot/<project-id>` 文献集合维护、PaperNexus 刷新、reasoning packet 对齐、实验账本对齐

- `orchestrator`  
  风险、预算、计划清理，不改 active track

- `coder`  
  强化复现说明、smoke test、脚本维护、实现阶段科研绘图，不擅自发起新实验

- `analyzer`  
  figure/table skeleton、claim-evidence 提取准备

- `academic_writer`  
  大纲与 paragraph logic 检查、Zotero writing-shortlist 整理、维持保守措辞和模版一致性

- `reviewer`  
  review rubric、critical-thinking 清单和 scholar-eval 结构维护

## 6. 角色配置为什么这么拆

把 Agent 拆成多份 md 文件，而不是只保留一份 `AGENTS.md`，主要是为了：

- 更接近 OpenClaw 官方约定
- 让 boot / bootstrap / heartbeat 三类时机有不同规则
- 让角色身份、工具边界、流程规范分离
- 降低单一超长 prompt 的耦合度

## 7. workflow guard 代码结构

为了让这些 Agent 规则和阶段 gate 可维护，workflow guard 现在采用 facade + 子模块结构：

- [workflow-guard.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard.ts)
  对外公共入口、兼容层和有限 glue。
- [workflow-guard-core/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-core/)
  通用 helper。
- [workflow-guard-state/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-state/)
  durable state contract。
- [workflow-guard-stages/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-stages/)
  stage-specific gate 判定。
- [workflow-guard-materializers/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-materializers/)
  ideation / story / review pressure 合同生成。
- [workflow-guard-summaries/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-summaries/)
  `/workflow-status` 等摘要逻辑。
- [workflow-guard-guidance/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/)
  dynamic task 与 concern-specific guidance。

命令侧也有对应的正式子模块：

- [workflow-commands/](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-commands/)
  负责 `types / parsers / formatters`，主命令注册和 dispatch 仍在父文件 [workflow-commands.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-commands.ts)。
