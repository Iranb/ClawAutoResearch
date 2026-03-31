# 科研工作流与自动迭代器

## 1. 工作流核心思想

当前 workflow 已经不是“Agent 自己记住接下来该做什么”，而是“项目状态决定下一步该做什么”。  
状态的权威来源主要是：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `researcher/GATE_STATE.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `PROJECTS_STATE.json`

## 2. 阶段机

系统当前的主阶段机如下：

| Stage | Owner | Next |
| --- | --- | --- |
| `setup` | `researcher` | `graph_build` |
| `graph_build` | `researcher` | `frontier_mapping` |
| `frontier_mapping` | `researcher` | `idea` |
| `idea` | `researcher` | `plan` |
| `plan` | `orchestrator` | `code` |
| `code` | `coder` | `experiment` |
| `experiment` | `researcher` | `analyze` |
| `analyze` | `analyzer` | `review` |
| `review` | `reviewer` | `write` |
| `write` | `academic_writer` | `submit` |
| `submit` | `reviewer` | `done` |
| `revise` | `researcher` | `write` |
| `done` | `researcher` | `done` |

每个阶段都对应明确 owner、下一阶段和阶段进入时的 `micro_stage`。

## 3. workflow guard 如何约束执行

workflow guard 在运行时做四类事情：

- 注入 snapshot：让 Agent 在每轮前看到当前 stage、owner、缺失信号、允许联系对象、允许写入范围
- 阻止越界：阻止不允许的文件写入、spawn、sessions_send 和 mailbox 通信
- 注入后台任务：在 heartbeat / idle turn 上提供 bounded task，而不是让 Agent 自由漂移
- 驱动自动迭代器：在恢复或空闲轮次上优先做 deterministic reconciliation

从 2026-03-31 起，snapshot prompt 的组装策略也专门做了“减载”：

- 先给稳定策略层：当前角色、当前 owner、不要扩 scope
- 再给阶段局部控制层：`next_action`、`blocking_reason`、`missing_signals`、owner gate
- 最后才给主载荷和补充证据，而且只在当前角色 / 当前 stage 真正相关时才注入

这里有两个提醒被刻意保留为高优先级、不会因为 prompt 精简而消失：

- handoff / owner gate 提醒
- `research_workflow.auto_iterator_tick` 边界提醒

原因很简单：很多“忘记当前该谁做”“上一阶段刚做完就直接跳到下一阶段”“心跳轮次一上来就手写计划”的问题，本质都不是能力不足，而是 prompt 里真正关键的 workflow 边界被无关状态淹没了。

## 4. 自动迭代器是什么

自动迭代器对应 `research_workflow.auto_iterator_tick`。  
它是这套系统从“文档驱动自动化”升级到“代码驱动自动化”的关键。

它的工作包括：

- 读取当前项目 manifest、track registry、gate state、experiment ledger
- 判断当前阶段是否缺关键完成信号
- 必要时回退到更早阶段
- 在信号齐全时推进到下一阶段
- 推导当前推荐 owner
- 将 handoff 信息写入 mailbox
- 同步 `PROJECTS_STATE.json`
- 在必须人工决策的地方明确阻塞

## 5. 什么时候会触发 auto iterator

当前推荐的触发方式有三类：

- heartbeat turn
- bootstrap turn
- recovery / resume turn

Researcher 的 heartbeat 和 bootstrap 文档都已经要求优先调用 auto iterator。

因此现在的 prompt 也会把这条规则放在靠前位置，而不是藏在一大段 PaperNexus / writing / review 状态后面。

## 6. auto iterator 输出什么

`auto_iterator_tick` 返回的结果至少会包含这些信息：

- `projectRoot`
- `projectId`
- `mode`
- `stageBefore`
- `stageAfter`
- `ownerBefore`
- `ownerAfter`
- `actions`
- `blockingReasons`
- `mailboxQueued`

其中 `actions` 里会给出建议动作类型，例如：

- `drive_stage`
- `background`
- `wait_human`
- `switch_project`

## 7. 它如何实现“自动迭代”

严格来说，自动迭代不是“Agent 自己随便继续干”，而是：

1. 检查状态是否完整
2. 如果阶段未完成，提醒 owner 继续执行
3. 如果阶段完成，推进到下一阶段
4. 如果下一阶段 owner 不是当前 Agent，就进行 handoff
5. 如果存在 idle_research 或 PaperNexus refresh 等后台任务，就给出 bounded work
6. 如果遇到必须人工决策的 gate，就停下

所以实际执行顺序应该理解成：

1. 先 `auto_iterator_tick`
2. 再看当前 owner 是不是自己
3. 是自己就做当前 stage 的局部任务
4. 不是自己就 handoff，而不是“顺手继续干一点”

所以它的价值在于：

- 减少人为盯盘
- 减少 prompt 漂移
- 增强重启恢复
- 让并行项目更稳定

## 8. 它不是完全无人值守的地方

当前 workflow 仍然保留必要的人类 gate，尤其是投稿和高风险方向决策。  
也就是说，这套系统是“高度自动化的科研执行器”，不是“无条件完全自治的投稿机器人”。

## 9. 与 heartbeat 的关系

`openclaw.json` 推荐把 heartbeat 显式配置到各个 workflow agent 上，例如：

```js
list: [
  { id: "researcher", heartbeat: { every: "30m" } },
  { id: "orchestrator", heartbeat: { every: "2h" } },
  { id: "coder", heartbeat: { every: "2h" } },
  { id: "analyzer", heartbeat: { every: "2h" } },
  { id: "academic_writer", heartbeat: { every: "2h" } },
  { id: "reviewer", heartbeat: { every: "3h" } },
  { id: "cross-reviewer", heartbeat: { every: "4h" } }
]
```

这意味着只要对应 Agent 心跳正常，系统就有周期性机会去：

- 检查阶段是否可推进
- 检查 mailbox
- 检查 idle_research 是否到期
- 检查 innovation reflection 是否过期
- 检查 writing contract 是否缺模版

## 10. 典型自动迭代场景

### 场景 A：setup 已完成

- manifest、track registry、claim policy、graph、experiment ledger 都存在
- auto iterator 会把项目推进到 `graph_build`

### 场景 B：Writer 模版缺失

- 当前处于 `write`
- `writing_contract.template_required = true`
- 模版路径不可读
- auto iterator 不会放 Writer 继续写，而是保持阻塞并给出恢复建议

### 场景 C：实验做完后再次 ideation

- ledger 中出现了新的可反思实验结果
- `innovation_reflection` 仍然是旧的
- 插件会要求先刷新 `INNOVATION_REFLECTION.md`

## 11. Discord 响应性与后台子 Agent

随着 workflow 越来越依赖后台子 Agent、shared graph、PaperNexus import 和自动调度，`Researcher` 的一个新问题变得越来越重要：

- 用户在 Discord 或 Dashboard 上触发任务后，前台容易“看起来没有反应”
- 实际上后台可能已经在排队、等待 PaperNexus import、等待 graph refresh，或者复用了已有子会话

因此，后续 workflow 的一个重点演进方向是：

- 统一 `Researcher` 的后台子 Agent 会话池
- 给用户可见的 `started / queued / waiting / blocked / completed` 状态广播
- 将 `waiting_import / waiting_graph / reconciling` 建模成正式 runtime state

详细设计见：

- [Researcher Discord 响应性与后台子 Agent 控制设计](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/docs/superpowers/specs/2026-03-28-researcher-discord-responsiveness-design.zh-CN.md)
