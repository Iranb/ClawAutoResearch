# IDEA-CATALYST KG 与 IDEA 子流水线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先补齐 PaperNexus 的 domain/mechanism/bridge KG primitive，再把 IDEA-CATALYST 作为 IDEA 阶段内部的正式子流水线接入 openclaw-research。

**Architecture:** PaperNexus 负责提供稳定的 KG/schema 与 bridge query adapter，openclaw-research 负责用独立的 idea-catalyst 模块把 decomposition / abstraction / scouting / gatekeeping / integration / judging 接成 workflow-owned 子流水线，并继续汇总到已有 ideation_contract。

**Tech Stack:** Node.js, TypeScript, existing workflow runtime tools, PaperNexus ingestion/graph/query stack, node:test

---

### Task 1: 写红测，钉住 PaperNexus KG/schema primitive

**Files:**
- Modify: `/workspace/PaperNexus/test/semantic-extraction.test.js`
- Create: `/workspace/PaperNexus/test/idea-catalyst-schema.test.js`

- [ ] **Step 1: 新增/扩展测试，要求 semantic extraction 能保留 field/domain/mechanism 元数据**
- [ ] **Step 2: 运行 PaperNexus 定向测试，确认先失败**
- [ ] **Step 3: 测试覆盖新增 schema 与 bridge helper 的最小 contract**

### Task 2: 实现 PaperNexus schema primitive

**Files:**
- Modify: `/workspace/PaperNexus/src/core/graph/schema.js`
- Create: `/workspace/PaperNexus/src/core/graph/domain-taxonomy.js`
- Create: `/workspace/PaperNexus/src/core/graph/abstract-mechanisms.js`
- Create: `/workspace/PaperNexus/src/core/graph/domain-bridges.js`

- [ ] **Step 1: 新增 node/edge 类型与 helper，不破坏现有 graph API**
- [ ] **Step 2: 实现最小 domain normalization / distance matrix helper**
- [ ] **Step 3: 实现 mechanism bridge query helper**
- [ ] **Step 4: 运行定向测试直到通过**

### Task 3: 接线 PaperNexus ingestion / LLM extraction

**Files:**
- Modify: `/workspace/PaperNexus/src/core/llm/ollama.js`
- Modify: `/workspace/PaperNexus/src/core/ingestion/pipeline.js`

- [ ] **Step 1: 扩 semantic extraction prompt，让 paper/problem/method 支持 field/domain/mechanism 元数据**
- [ ] **Step 2: 在 pipeline merge 路径中持久化这些元数据**
- [ ] **Step 3: 运行 semantic extraction 测试与相关 pipeline 测试**

### Task 4: 在 openclaw-research 写红测，钉住 IDEA-CATALYST 子流水线 contract

**Files:**
- Create: `/workspace/openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `/workspace/openclaw-research/tests/auto-iterator.test.mjs`
- Modify: `/workspace/openclaw-research/tests/workflow-runtime-tools.test.mjs`

- [ ] **Step 1: 先写 IDEA 微阶段与 catalyst packet 缺失时的 failing tests**
- [ ] **Step 2: 写 workflow tool 对 decomposition/scouting/judging packet 的 failing tests**
- [ ] **Step 3: 运行定向测试，确认失败原因正确**

### Task 5: 新建 idea-catalyst 模块，不把逻辑塞进 workflow-guard

**Files:**
- Create: `/workspace/openclaw-research/tools/idea-catalyst/packets.ts`
- Create: `/workspace/openclaw-research/tools/idea-catalyst/materializers.ts`
- Create: `/workspace/openclaw-research/tools/idea-catalyst/scout-adapter.ts`
- Create: `/workspace/openclaw-research/tools/idea-catalyst/ranking.ts`
- Create: `/workspace/openclaw-research/tools/idea-catalyst/workflow-bridge.ts`

- [ ] **Step 1: 定义 catalyst packet normalize/serialize helper**
- [ ] **Step 2: 定义 workflow-owned materializer**
- [ ] **Step 3: 定义 scout adapter，读取 PaperNexus bridge contract**
- [ ] **Step 4: 定义 pairwise / Elo-style ranking helper**

### Task 6: 接入 runtime tools 与 IDEA 微阶段

**Files:**
- Modify: `/workspace/openclaw-research/tools/register-workflow-tools.ts`
- Modify: `/workspace/openclaw-research/tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `/workspace/openclaw-research/tools/workflow-guard-stages/ideation-stage-signals.ts`
- Modify: `/workspace/openclaw-research/templates/PROJECT_MANIFEST.json`

- [ ] **Step 1: 注册 catalyst workflow tools**
- [ ] **Step 2: 让 IDEA 阶段 preflight 能自动 materialize catalyst packet**
- [ ] **Step 3: 把 IDEA 微阶段缺失信号接入 stage signals**
- [ ] **Step 4: 只做薄 glue，避免大段逻辑回流到 workflow-guard.ts**

### Task 7: 更新 skill / agent / workflow 文档

**Files:**
- Modify: `/workspace/openclaw-research/WORKFLOW.md`
- Modify: `/workspace/openclaw-research/skills/researcher/research-ideation/SKILL.md`
- Modify: `/workspace/openclaw-research/skills/researcher/idea-tournament/SKILL.md`
- Create: `/workspace/openclaw-research/skills/researcher/idea-catalyst-decompose/SKILL.md`
- Create: `/workspace/openclaw-research/skills/researcher/idea-catalyst-translate/SKILL.md`
- Create: `/workspace/openclaw-research/skills/researcher/idea-catalyst-scout/SKILL.md`
- Create: `/workspace/openclaw-research/skills/researcher/idea-catalyst-gatekeeper/SKILL.md`
- Create: `/workspace/openclaw-research/skills/researcher/idea-catalyst-integrator/SKILL.md`
- Create: `/workspace/openclaw-research/skills/reviewer/idea-catalyst-judge/SKILL.md`

- [ ] **Step 1: 写清楚 IDEA-CATALYST 是 IDEA 子流水线**
- [ ] **Step 2: 写清楚 graph-first + bridge-first scouting 规则**
- [ ] **Step 3: 写清楚 requisition -> graph-build feedback loop**

### Task 8: 验证与收尾

**Files:**
- Modify: `/workspace/openclaw-research/docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`

- [ ] **Step 1: 跑 PaperNexus 定向测试**
- [ ] **Step 2: 跑 openclaw-research 定向测试**
- [ ] **Step 3: 跑 build**
- [ ] **Step 4: 回写 blueprint 的实施进度**
