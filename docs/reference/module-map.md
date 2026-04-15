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
| `tools/workflow-guard.ts` | 公共 facade、兼容导出、有限 glue；不再承载大块 project/policy/setter 逻辑 |
| `tools/workflow-guard-project/` | project root 解析、gate state、projects state、snapshot builder |
| `tools/workflow-guard-policies/` | role policy、tool guards、handoff mention sanitization |
| `tools/workflow-guard-writing/` | writing/review/theory/citation 的 readiness 与 quality evaluation |
| `tools/workflow-guard-setters/` | `set*State(...)` 家族，负责 manifest/runtime 持久化 |
| `tools/workflow-guard-state/` | durable state schema 与辅助处理 |
| `tools/workflow-guard-stages/` | stage-specific gate 和 signals |
| `tools/workflow-guard-materializers/` | `research_program`、story、review packet 等合同生成 |
| `tools/workflow-guard-guidance/` | prompt-layer guidance 与 dynamic tasks |
| `tools/workflow-guard-runtime/` | auto iterator、background continuation、session orchestration |
| `tools/workflow-guard-recorders/` | experiment/review/writing 等 runtime recorder 与 append-only 写入 |
| `tools/workflow-hooks/` | hook policy/state、file audit runner、aggregate revision dispatch、hook gateway execution |
| `tools/lobster-handoff.ts` | Lobster 作为可选 handoff backend 的接入点，负责 Lobster/native 选择与 fallback |
| `tools/workflow-handoff-runtime.ts` | mailbox handoff item、ack 与 handoff runtime 细节 |

## 3. graph / PaperNexus family

| 路径 | 重点 |
| --- | --- |
| `tools/graph-presence.ts` | graph presence、shared corpus、repair target 解析 |
| `tools/papernexus-*` | remote access、progress、wrapper、packet materialization |
| `tools/workflow-runtime-refresh.ts` | 运行时 refresh 与 snapshot 同步 |

## 4. broad paper search / literature backbone

| 路径 | 重点 |
| --- | --- |
| `tools/paper-source-contract.ts` | canonical paper/source contract、resolution status、metadata-only 语义 |
| `tools/paper-source-index-writer.ts` | `PAPER_SOURCE_INDEX.json` 的 authoritative merge / upsert writer |
| `tools/research30/query-planner.ts` | deterministic query planning |
| `tools/research30/provider-*.ts` | OpenAlex / Semantic Scholar / Crossref / Unpaywall / CORE / DBLP provider adapters |
| `tools/research30/venue-registry.ts` | top-tier venue alias normalization 与 venue packs |
| `tools/research30/merge.ts` | canonical merge、provider agreement、selection scoring |
| `tools/research30/source-resolution.ts` | OA/PDF resolution 与 metadata-only fallback |
| `tools/research30/diagnostics.ts` | broad search diagnostics / Markdown report |
| `tools/research30/workflow-bridge.ts` | broad search workflow entrypoint，负责 artifact 落盘与 source-index 更新 |

## 5. ideation / literature / writing families

| 路径 | 重点 |
| --- | --- |
| `tools/idea-catalyst/` | decomposition、translation、scout、gatekeeper、integrator |
| `tools/literature-discovery/` | discovery requisition、frontier support |
| `tools/research-writing/` | story bridge、citation grounding、revision cycle、写作支撑产物 |

## 6. tests 应该怎么看

优先看这些回归套件：

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-control-plane-phase-3.test.mjs`
- `tests/workflow-web-doc.test.mjs`
- `tests/writer-reviewer-runtime-state.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`
- `tests/lobster-handoff.test.mjs`
- `tests/workflow-hooks-state.test.mjs`
- `tests/workflow-hooks-executor.test.mjs`
- `tests/workflow-file-audit.test.mjs`
- `tests/workflow-file-audit-runtime-tools.test.mjs`

它们分别守住推进器、工具接口、控制平面阶段约束、文档站结构、Lobster fallback 语义、workflow hooks/control-plane 审计闭环，以及普通论文/综述论文两条写作主线。

新增的 decomposition-focused 套件：

- `tests/workflow-guard-project-context.test.mjs`
- `tests/workflow-guard-gate-state.test.mjs`
- `tests/workflow-guard-projects-state.test.mjs`
- `tests/workflow-guard-snapshot-builder.test.mjs`
- `tests/workflow-guard-policies.test.mjs`
- `tests/workflow-guard-handoff-rules.test.mjs`
- `tests/workflow-guard-tool-guards.test.mjs`
- `tests/workflow-guard-writing-eval.test.mjs`
- `tests/workflow-guard-paper-quality-eval.test.mjs`
- `tests/workflow-guard-citation-theory-eval.test.mjs`
- `tests/workflow-guard-setters.test.mjs`
- `tests/workflow-guard-setters-split.test.mjs`
- `tests/workflow-guard-review-state-setters.test.mjs`
- `tests/workflow-guard-ingestion-state-setters.test.mjs`

新增的 broad paper search 相关回归：

- `tests/paper-source-index-writer.test.mjs`
- `tests/research30-query-planner.test.mjs`
- `tests/research30-workflow-bridge.test.mjs`

## 7. agents 和 skills 所在位置

- `agents/`：角色配置、BOOTSTRAP、HEARTBEAT、TOOLS 等。
- `skills/`：分角色和分阶段的执行协议。
- `templates/`：项目初始化和状态文件模板。

维护时不要只改工具代码不改模板，因为很多行为假设 template shape 已同步。
