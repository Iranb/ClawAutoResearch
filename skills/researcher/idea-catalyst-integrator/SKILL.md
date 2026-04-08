---
name: idea-catalyst-integrator
description: Use when IDEA-CATALYST has enough scouting evidence and must synthesize target-domain challenges with source-domain takeaways into structured idea fragments.
argument-hint: "[gate decision or scouting report]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Integrator

这一步负责把 target-domain challenge 和 source-domain takeaways 合成为结构化 idea fragments。

## 目标

生成 `IDEA_FRAGMENTS.json`，不是一段随意 brainstorm 文本。

## 每个 fragment 至少要有

- `idea_fragment`
- `core_insight`
- `integration_mechanism`
- `challenge_resolution`
- `concrete_realization`

## 约束

- 不要一边生成一边提前排序
- 不要把不同 domain 的启发压扁成一句“借鉴 X”
- 必须把 challenge-resolution 和 method realization 绑定起来

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/IDEA_FRAGMENTS.json`
