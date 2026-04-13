# IDEA-CATALYST KG 与 IDEA 子流水线设计

> 日期：2026-04-03  
> 范围：优先实现 PaperNexus 侧 KG/schema primitive，再把 IDEA-CATALYST 作为 `IDEA` 阶段内部的正式子流水线接入 `openclaw-research`。  
> 约束：新逻辑尽量落到独立模块，避免继续膨胀 `tools/workflow-guard.ts`。

## 目标

把 IDEA_CATALYST_MultiAgent_Blueprint.md 里的两条主线落地：

1. `PaperNexus` 先具备最小可用的跨领域 KG/schema primitive  
2. `openclaw-research` 的 `IDEA` 阶段拥有正式的 IDEA-CATALYST 子流水线，而不是只靠单个脚本或 prompt

## 总体策略

这轮按用户要求走：

- **先做 PaperNexus 侧 KG/schema**
- **再回头接 workflow**
- **IDEA-CATALYST 作为 IDEA 阶段里的正式子流水线**
- **不要把新逻辑都堆进 `workflow-guard.ts`**

为了不被 taxonomy 和旧脚本绑定卡住，这轮采用 `adapter-first` 方案：

- KG/schema 先提供一层稳定的 domain / mechanism / bridge primitive
- workflow 通过 adapter 使用这些 primitive
- 具体 taxonomy 与旧 `pn_idea_catalyst.py` 的迁移方式，等做到对应阶段再和用户确认

## Phase α: PaperNexus KG/schema 最小实现

### 1. Domain/Field 元数据

先不强行把所有领域知识建成完整本体，而是增加最小可用元数据：

- `Paper` 节点支持：
  - `fieldOfStudy`
  - `fieldCandidates`
  - `domainTags`
- `Problem` / `Method` / `Limitation` 节点支持：
  - `domainTags`
  - `mechanismHints`

### 2. AbstractMechanism 层

新增：

- `NODE_TYPES.ABSTRACT_MECHANISM = 'AbstractMechanism'`
- 边类型：
  - `INSTANTIATES`
  - `IMPLEMENTS`
  - `CONSTRAINS`
  - `BELONGS_TO_DOMAIN`
  - `STUDIED_IN`
  - `ORIGINATED_IN`

这层先允许通过 LLM extraction 和轻量 backfill 生成，后续再逐步增强。

### 3. Domain Distance 与 Bridge 查询

先做轻量版本，不直接上结构同构：

- 基于 `field/domain` 共现关系生成 `domain distance matrix`
- 新增 PaperNexus 侧 query helper：
  - 给定 target domain / abstract challenge
  - 返回跨领域候选 nodes / domains / bridge evidence

输出 contract 至少包括：

- `targetDomain`
- `candidateDomains`
- `domainDistance`
- `mechanismMatches`
- `bridgeNodes`
- `evidence`

### 4. 保持兼容

这一轮不强行重构旧 `pn_idea_catalyst.py`，而是先让它未来可以消费这些新 primitive。

## Phase β: IDEA-CATALYST 作为 IDEA 子流水线

### 子流水线微阶段

把 `IDEA` 阶段扩成显式微阶段：

- `idea/decomposition`
- `idea/abstraction`
- `idea/scouting`
- `idea/gatekeeping`
- `idea/integration`
- `idea/judging`

并映射到现有 `IDEA` 主阶段，不创建新的顶层 stage。

### Durable artifacts

固定产物路径：

- `{PROJ}/researcher/idea-catalyst/DECOMPOSITION_PACKET.json`
- `{PROJ}/researcher/idea-catalyst/ABSTRACTION_PACKET.json`
- `{PROJ}/researcher/idea-catalyst/SCOUTING_REPORT.json`
- `{PROJ}/researcher/idea-catalyst/GATE_DECISION.json`
- `{PROJ}/researcher/idea-catalyst/IDEA_FRAGMENTS.json`
- `{PROJ}/researcher/idea-catalyst/RANKED_FRAGMENTS.json`
- `{PROJ}/researcher/idea-catalyst/INVESTIGATION_REQUISITION.json`
- `{PROJ}/researcher/idea-catalyst/CATALYST_SESSION_STATE.json`

这些产物继续汇总回现有 durable contract：

- `ideation_contract`
- `GRAPH_IDEATION_PACKET.json`
- `CANDIDATE_POOL.json`
- `RANKING_HISTORY.json`
- `TOP3_DIRECTION_SUMMARY.md`
- `RESEARCH_PROPOSAL.md`
- `TRACK_REGISTRY.json`

### Agent roles

保留 blueprint 中的 6 个角色，但用 workflow-owned materializer / tool + skill 文档落地：

- Decomposer
- Translator
- Scout
- Gatekeeper
- Integrator
- Judge

其中：

- `Judge` 归 reviewer 口径
- 其他默认归 researcher 口径

### Researcher 的新职责边界

在 graph 上传 / 同步改成 workflow-owned 之后，Researcher 不再负责“上传执行”。  
Researcher 在 IDEA-CATALYST 中的职责是：

- 分解问题
- 生成双重表述
- 读取 KG bridge
- 组织 cross-domain 候选
- 生成 idea fragments
- 汇总回 ideation contract / track registry

## 模块化设计

### PaperNexus repo

优先新增独立模块，而不是把逻辑塞回旧文件：

- `src/core/graph/schema.js`
- 新增 `src/core/graph/domain-taxonomy.js`
- 新增 `src/core/graph/domain-bridges.js`
- 新增 `src/core/graph/abstract-mechanisms.js`
- 在 `src/core/llm/ollama.js` / `src/core/ingestion/pipeline.js` 只做薄接线

### openclaw-research repo

优先新增：

- `tools/idea-catalyst/packets.ts`
- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/scout-adapter.ts`
- `tools/idea-catalyst/ranking.ts`
- `tools/idea-catalyst/workflow-bridge.ts`

`workflow-guard.ts` 只保留：

- 类型导出
- facade 级调用
- 少量 stage glue

而不内联核心 catalyst 逻辑。

## 与现有 ideation contract 的关系

这轮不是创建平行记忆系统，而是在现有 graph-first ideation contract 上加 catalyst layer：

- `research-ideation` 仍然负责 novelty tree / challenge-insight tree / solution check / transfer / decomposition 的主骨架
- IDEA-CATALYST 提供更强的：
  - decomposition packet
  - dual abstraction quality control
  - graph-first cross-domain scouting
  - gatekeeping
  - pairwise judging

最终仍由 `idea-tournament` 和 `materialize_ideation_contract` 汇总。

## 本轮明确不做

本轮不直接实现：

- 完整结构同构类比检测
- 重型 vector index
- 全量自动 backfill 历史 corpus
- 直接替换旧 `pn_idea_catalyst.py`

## 需要后续确认的决策点

按用户要求，做到对应阶段时再问：

1. Domain taxonomy  
   是否采用 Semantic Scholar 19 个 top-level fields，还是更细粒度 taxonomy
2. 旧 `pn_idea_catalyst.py`  
   是原地重构，还是与新的 `PaperNexusCatalyst/` 并存

当前默认策略只是保证实现不把这两个问题提前锁死。
