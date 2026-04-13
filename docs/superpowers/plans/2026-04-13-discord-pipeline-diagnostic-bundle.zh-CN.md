# Discord 全自动流水线诊断包方案

**状态：** implementing  
**日期：** 2026-04-13  
**目标：** 给 Discord 上运行的全自动科研/综述流水线提供一套稳定、统一、低摩擦的问题现场抓取机制，使一次失败可以沉淀为一个可复现、可共享、可比较的诊断包。

---

## 1. 背景与问题

当前问题不是“没有日志”，而是**日志分散**：

- manifest / snapshot
- runtime queue / sessions
- workflow events / trace
- mailbox / handoff intents / handoff events
- graph / PaperNexus presence
- review / citation / compile

这些信息分别散落在：

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/.openclaw-research/*.json*`
- `{PROJ}/graph/*`
- `{PROJ}/reviewer/*`
- `{PROJ}/academic_writer/*`

当 Discord 里的 `/auto-research` 或 `/auto-review` 跑崩时，手工收集这些文件成本高，而且容易漏掉最关键的上下文。

---

## 2. 设计目标

### 2.1 主要目标

实现一个**诊断包 capture 功能**，在问题出现时一次性导出：

- 当前 workflow snapshot
- runtime health
- channel binding / binding index
- queue / sessions / mailbox / handoff / team task graph
- graph presence / PaperNexus progress
- writing / review / citation / compile 的关键产物
- 最近的 runtime event / trace / inbound turn tail

### 2.2 设计原则

1. **稳定优先，不走 ad hoc grep**
2. **bundle 固定结构，便于比较两次失败**
3. **有界采集**
4. **默认不导出 secret**
5. **项目内落盘，便于用户直接回传**

---

## 3. 需要的日志与证据

### 3.1 控制平面

- `snapshot.json`
- `runtime-health.json`
- `manifest.json`
- `track-registry.json`

### 3.2 绑定与路由

- `channel-binding.json`
- `channel-bindings.json`

### 3.3 运行时

- `runtime-queue.json`
- `runtime-sessions.json`
- `runtime-events.tail.json`
- `workflow-trace.tail.json`
- `workflow-inbound-turns.tail.json`

### 3.4 handoff / 协作

- `mailbox.json`
- `handoff-intents.json`
- `handoff-events.tail.json`
- `task-graph.json`
- `team-round.json`

### 3.5 graph / PaperNexus

- `graph-presence.json`
- `papernexus-status.json`
- `papernexus-progress.json`
- `literature-coverage.json`
- `GRAPH_BUILD_REPORT.md`（若存在）

### 3.6 写作 / 审稿

- `academic_writer/WRITING_SIGNALS.md`
- `reviewer/CITATION_VERIFICATION.md`
- `reviewer/CITATION_CALIBRATION.md`
- `reviewer/REVIEW_ISSUES.json`
- `reviewer/REVIEW_PACKET.json`
- `academic_writer/paper/compile.log.tail`

---

## 4. 产物结构

诊断包固定写到：

```text
{PROJ}/.openclaw-research/diagnostics/<timestamp>-<reason>/
```

目录至少包含：

- `INDEX.json`
- `SUMMARY.md`
- 其余标准 bundle 文件

其中：

- `INDEX.json` 作为机器入口
- `SUMMARY.md` 作为人工入口

---

## 5. 触发入口

### 5.1 runtime action

新增：

- `research_workflow.capture_diagnostic_bundle`

适合：

- agent 在发现 blocker 后自动抓包
- reviewer / researcher 在修复前固定现场

### 5.2 slash command

新增：

- `/capture-diagnostics`

适合：

- 你在 Discord 里发现流水线卡住
- 想一键把现场收好给我分析

支持参数：

- `--reason <text>`
- `--tail <N>`

---

## 6. 边界与红线

1. 不复制整个项目目录
2. 默认只 tail 大日志，不全量复制 JSONL
3. 不把 token / secret 写入 bundle
4. 不因为抓诊断包而改 stage / owner / review verdict

---

## 7. 验收标准

- 能从 bound 项目成功生成诊断包
- `SUMMARY.md` 和 `INDEX.json` 必存在
- 能覆盖 snapshot / runtime health / handoff / graph / review 关键证据
- slash command 与 runtime action 都可用
- tests 覆盖：
  - slash command
  - runtime action
  - 输出目录结构

---

## 8. 实施任务

- [x] 新增诊断 bundle helper
- [x] 接入 `research_workflow.capture_diagnostic_bundle`
- [x] 接入 `/capture-diagnostics`
- [x] 为命令层增加测试
- [x] 为 runtime tool 增加测试
- [x] 更新运维文档

