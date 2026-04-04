---
name: idea-catalyst-scout
description: Use when IDEA-CATALYST needs graph-first cross-domain scouting, domain-distance filtering, and source-domain takeaways after abstraction is ready.
argument-hint: "[abstraction packet or active challenge]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Scout

这是 IDEA-CATALYST 最关键的一步：先走图，再让 LLM 辅助，而不是让模型自由猜 source domain。

## 目标

输出 `SCOUTING_REPORT.json`，其中至少要有：

- 候选 source domains
- domain distance / selection basis
- bridge nodes / takeaways
- relevance pruning 结果

## 协议

1. 先复用图里的 domain / transfer / bridge 线索。
2. 优先用 graph-first traversal 和现有 `GRAPH_IDEATION_PACKET.json`。
3. 只有图证据不足时，才做 LLM-assisted fallback。
4. 保留为什么选这些 domain，而不是只给结果。

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/SCOUTING_REPORT.json`

## 红线

- 不允许退化成“列 3 个看起来相关的学科”
- 不允许只按 target-domain 邻近领域做保守扩展
