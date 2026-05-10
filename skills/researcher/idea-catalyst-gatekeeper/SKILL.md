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
- 明确写出 `decision boundary`：什么条件下继续 `BRAINSTORM`，什么条件下必须进入 `INVESTIGATION_REQUISITION`
- `BRAINSTORM` 需要具体 source-domain concept / framework / mechanism，且能映射到 domain-agnostic challenge
- 不允许用 LLM confidence 覆盖缺失证据；缺少 source span、supporting paper、bridge path 或 evidence chain ref 时，默认偏向 requisition
- 熟悉/近邻领域不自动充分，远距领域也不自动不充分；关键是是否提供概念杠杆和可追溯证据

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/GATE_DECISION.json`
- 如需补料：`{PROJ}/researcher/idea-catalyst/INVESTIGATION_REQUISITION.json`

## 与 workflow 的关系

当 Gatekeeper 产出 requisition 时，后续应回流到 ingestion / graph build / frontier refresh，而不是继续强行产 idea fragments。
