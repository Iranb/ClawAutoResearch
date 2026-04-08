# Agents 与 Skills

角色系统是这套 workflow 能稳定运行的另一个支点。它的目标不是把每个 Agent 都训练成全能选手，而是让系统明确知道：谁应该动哪一层状态，谁只能消费哪些输入。

## 1. 主要角色

| 角色 | 主职责 | 典型阶段 |
| --- | --- | --- |
| `researcher` | 项目 steward、graph build、frontier mapping、idea、resume、state sync | `setup` -> `idea` |
| `orchestrator` | `research_program`、alternatives、selection、TODO orchestration | `plan` |
| `coder` | 实验实现、运行准备、远程执行与结果落盘 | `code` / `experiment` |
| `analyzer` | claim-evidence、verdict、figures、theory support、story hooks | `analyze` |
| `academic_writer` | paper plan、template mapping、section drafting | `write` |
| `reviewer` | review pressure、quality gate、submit readiness | `review` / `submit` |
| `cross-reviewer` | 外部视角审读与 late-stage critique | late review |

## 2. 角色边界不仅是文档约定

这些边界同时体现在：

- `agents/` 目录里的角色文件
- `WORKSPACE.md` 中的写入路径规则
- workflow guard 的 write scope enforcement
- allowed contacts / spawn rules
- mailbox、cooldown 和 handoff 规则

所以“某个 Agent 偶尔跨目录改一下没关系”在这里并不成立。那会破坏系统恢复和审计能力。

## 3. 为什么要保留 workflow mailbox

聊天频道里的 mention 很容易造成两个问题：

- 重复唤醒
- 上下文污染

`workflow mailbox` 的作用是把交接变成结构化事件，而不是嘈杂聊天。它通常用来承载：

- blocker
- handoff
- request
- note
- ack

Researcher、Orchestrator、Writer 等角色在恢复现场时，应该优先读 mailbox 和 snapshot，而不是通篇翻聊天。

## 4. skills 不是提示词仓库

`skills/` 中的每个 skill 更像“可执行协议”。例如：

- `research-pipeline`
- `graph-build`
- `idea-phase`
- `plan-research`
- `implement-experiment`
- `analyze-results`
- `paper-write`
- `review-phase`

它们描述的是阶段化动作和约束，而不是一段华丽 prompt。

## 5. Skill 与 workflow guard 的分工

一个简单的判断方式：

- Skill 负责说明“这件事应该怎么做”。
- Workflow guard 负责说明“哪些事情绝不能乱做”。

举例来说，`paper-write` skill 会描述如何消费 story contract 组织稿件，而 workflow guard 会保证 Writer 不会越权去修改不属于自己的项目状态。

## 6. 研究阶段里最关键的角色交接

- `researcher -> orchestrator`
  - 在 ideation 收敛完成后，把 active tracks 和 ideation packet 交给 plan 阶段。
- `orchestrator -> coder`
  - 在 `research_program` 成形后，把 execution graph 和 TODOs 交给代码执行。
- `coder -> analyzer`
  - 在实验结果具备分析条件后，把 result paths 和 ledger 交给分析。
- `analyzer -> reviewer -> academic_writer`
  - 在 claims 成形后，先经历 review pressure，再进入写作。

## 7. Cross-reviewer 为什么几乎不持有主动写权限

这是有意设计的。Cross-reviewer 的价值是提供隔离视角，而不是加入主执行链。如果它和主执行者共享大面积写权限，就会降低“外部视角”本身的可信度。

## 8. 维护角色系统时最重要的纪律

新增能力时必须同时回答：

- 这个能力属于哪个角色。
- 它写到哪里。
- 它需要读哪些 contract。
- 它是否需要 mailbox / handoff。
- 它会不会让某个角色越过原本的 owner boundary。
