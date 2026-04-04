---
name: idea-catalyst-gatekeeper
description: Use when IDEA-CATALYST needs a hard sufficiency decision after scouting, including whether to continue brainstorming or emit an investigation requisition.
argument-hint: "[scouting report]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Gatekeeper

不要把数据不足时的“勉强继续”伪装成创意。

## 目标

在 `SCOUTING_REPORT.json` 基础上做二元决策：

- `BRAINSTORM`
- `INVESTIGATION_REQUISITION`

## 要求

- 至少评估 sufficiency、relevance、bridge quality
- 如果证据不足，必须输出结构化 requisition，而不是模糊建议
- 这一阶段允许阻塞后续 Integrator / Judge

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/GATE_DECISION.json`
- 如需补料：`{PROJ}/researcher/idea-catalyst/INVESTIGATION_REQUISITION.json`

## 与 workflow 的关系

当 Gatekeeper 产出 requisition 时，后续应回流到 ingestion / graph build / frontier refresh，而不是继续强行产 idea fragments。
