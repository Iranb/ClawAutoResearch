---
name: idea-catalyst-translate
description: Use when IDEA-CATALYST needs mechanism-level domain-agnostic reformulation after decomposition and before scouting source domains.
argument-hint: "[decomposition packet or active track]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Translate

把目标领域问题改写成机制级抽象，而不是“去术语化的简单 paraphrase”。

## 目标

生成 durable 的 `ABSTRACTION_PACKET.json`，让 Scout 能拿着机制签名去图上找跨域桥。

## 核心要求

- 抽象必须描述 mechanism，不只是更简单的字面表达
- 为每个 challenge 写 2-3 个 `mechanism_signature`
- 如果图里已经有 mechanism / bridge 提示，要尽量对齐，而不是重新发明一套词
- 必须显式消费 decomposition packet 里的 `target-domain analysis`
- 要保留 `remaining challenges` 和 `overall assessment`，不要在翻译时把这些 target-domain analysis 信号丢掉

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/ABSTRACTION_PACKET.json`

## 什么时候不算完成

- 还保留明显 target-domain jargon
- 只写了更短的英文句子，没有机制信息
- 不能自然接到跨域检索和 source-domain query generation
