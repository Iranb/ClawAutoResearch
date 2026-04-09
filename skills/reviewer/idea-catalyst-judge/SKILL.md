---
name: idea-catalyst-judge
description: Use when IDEA-CATALYST needs independent pairwise ranking of interdisciplinary idea fragments after synthesis and before track integration.
argument-hint: "[idea fragments packet]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Judge

 Judge 必须和 Integrator 分离，generator must not judge its own output。

## 目标

对 `IDEA_FRAGMENTS.json` 做 pairwise ranking，输出 durable 的 `RANKED_FRAGMENTS.json`。

## 评估重点

- interdisciplinary novelty
- interdisciplinary usefulness
- target challenge fit
- feasibility under the current baseline / experiment envelope

## 协议

- 优先 pairwise / Elo-style，而不是单条 scalar 自评分
- 给出 ranking history 或 pairwise evidence
- 输出 top fragment，并说明为什么它比其他片段更值得进入 track registry

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/RANKED_FRAGMENTS.json`

## 边界

- Judge 不负责生成新 fragment
- Judge 不负责改写 proposal
- Judge 的工作结束后，结果会继续流向 `idea-tournament` 和 `TRACK_REGISTRY.json`
