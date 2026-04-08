# Module Map

这页是面向维护者的“代码地图”。当你需要定位行为发生在哪里时，从这里开始最省时间。

## 1. Plugin entry 与注册层

| 路径 | 作用 |
| --- | --- |
| `index.ts` | 插件入口与对外导出 |
| `tools/register-workflow-tools.ts` | 注册 `research_workflow` 动作 |
| `tools/register-memory-tools.ts` | 注册 `research_memory` 动作 |
| `tools/register-research-commands.ts` | 注册 slash commands |

## 2. workflow control plane

| 路径 | 重点 |
| --- | --- |
| `tools/workflow-guard.ts` | facade、入口胶水、state normalization |
| `tools/workflow-guard-state/` | durable state schema 与辅助处理 |
| `tools/workflow-guard-stages/` | stage-specific gate 和 signals |
| `tools/workflow-guard-materializers/` | `research_program`、story、review packet 等合同生成 |
| `tools/workflow-guard-guidance/` | prompt-layer guidance 与 dynamic tasks |
| `tools/workflow-guard-runtime/` | auto iterator、background continuation、session orchestration |

## 3. graph / PaperNexus family

| 路径 | 重点 |
| --- | --- |
| `tools/graph-presence.ts` | graph presence、shared corpus、repair target 解析 |
| `tools/papernexus-*` | remote access、progress、wrapper、packet materialization |
| `tools/workflow-runtime-refresh.ts` | 运行时 refresh 与 snapshot 同步 |

## 4. ideation / literature / writing families

| 路径 | 重点 |
| --- | --- |
| `tools/idea-catalyst/` | decomposition、translation、scout、gatekeeper、integrator |
| `tools/literature-discovery/` | discovery requisition、frontier support |
| `tools/research-writing/` | story bridge、citation grounding、revision cycle、写作支撑产物 |

## 5. tests 应该怎么看

优先看这些回归套件：

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-control-plane-phase-3.test.mjs`
- `tests/workflow-web-doc.test.mjs`

它们分别守住推进器、工具接口、控制平面阶段约束和文档站结构。

## 6. agents 和 skills 所在位置

- `agents/`：角色配置、BOOTSTRAP、HEARTBEAT、TOOLS 等。
- `skills/`：分角色和分阶段的执行协议。
- `templates/`：项目初始化和状态文件模板。

维护时不要只改工具代码不改模板，因为很多行为假设 template shape 已同步。
