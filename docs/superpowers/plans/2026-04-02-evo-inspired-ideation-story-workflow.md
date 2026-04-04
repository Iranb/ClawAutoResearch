# 基于 EvoScientist / EvoSkills 的创新设计与论文故事线增强 Workflow 实施计划

**状态：** 草稿  
**日期：** 2026-04-02  
**作者：** Codex  
**关联设计稿：** `docs/superpowers/specs/2026-04-02-evo-inspired-ideation-story-workflow-design.zh-CN.md`

---

## 1. 实施目标

把设计稿中的三层增强逐步接入现有 `openclaw-research`：

1. `ideation_contract`
2. `paper_story_state`
3. `review_pressure_packet`

并保证：

- 与当前阶段机兼容
- 与 graph-grounded brainstorm 兼容
- 与 baseline-aware code / experiment / review gate 兼容
- `/workflow-status` 可见
- 通过 durable state 持久化
- 尽量复用现有 graph-backed memory，而不新增独立 ideation memory

---

## 2. 任务拆分

## Task 1. 增加 durable state 类型与模板

目标：

- 在 `PROJECT_MANIFEST.json` 中新增三套状态
- 在 `workflow-guard.ts` 中加入类型、默认值、序列化与 snapshot 汇总
- 明确复用现有：
  - `brainstorm_cycle.working_memory_path`
  - `brainstorm_cycle.reflection_chain_path`
  - `brainstorm_cycle.storyline_brief_path`
  - `innovation_reflection`
  - `TRACK_REGISTRY.json` reasoning / synthesis / evidence pointers

约束：

- 不引入单独的 `ideation-memory.md` 作为新的事实源
- 新增的 graph ideation packet / indices 只作为 graph-native memory layer 的补充索引

文件：

- `templates/PROJECT_MANIFEST.json`
- `tools/workflow-guard.ts`

完成标准：

- manifest 模板包含新字段
- workflow snapshot 能安全读取缺省状态

---

## Task 2. 先补测试，锁住新 gate

目标：

- 在实现前用测试表达新的阶段约束

建议测试：

- `idea` 阶段在 `ideation_contract.status != ready` 时不能放行
- `plan` 阶段在缺失 `research_proposal` 时不能放行
- `write` 阶段在 `paper_story_state.status != ready` 时不能放行
- `review` 阶段在缺失 `review_pressure_packet` 时不能标记稳定写作 ready
- `/workflow-status` 能显示三套新状态

文件：

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/writer-reviewer-runtime-state.test.mjs`

---

## Task 3. 新增 workflow tool 读写入口

目标：

- 让 agent / skill 不用手改 manifest，而是通过 workflow tools 更新合同

新增工具：

- `research_workflow.get_ideation_contract`
- `research_workflow.set_ideation_contract`
- `research_workflow.get_paper_story_state`
- `research_workflow.set_paper_story_state`
- `research_workflow.get_review_pressure_packet`
- `research_workflow.set_review_pressure_packet`

文件：

- `tools/register-workflow-tools.ts`

---

## Task 4. 接入 `idea` 阶段

目标：

- 把 `idea` 阶段从“brainstorm report + novelty filter”升级成完整 ideation contract
- 把 `novelty tree / challenge-insight tree / well-established solution check` 改成 graph-first 生成，而不是纯文本整理
- 把 top-3 / do-not-repeat / failed direction / transferable lessons 写回现有 graph-backed memory

行为变化：

- `idea` 阶段必须依次补齐：
  - graph ideation packet
  - novelty tree
  - challenge-insight tree
  - solution check
  - cross-domain transfer
  - problem decomposition
  - candidate pool
  - tournament scoreboard
  - top-3 summary
  - research proposal

文件：

- `tools/workflow-guard.ts`
- `tools/register-workflow-tools.ts`
- `skills/researcher/idea-phase/SKILL.md`
- `skills/researcher/frontier-mapping/SKILL.md`
- `skills/researcher/innovation-reflection/SKILL.md`
- `agents/researcher/AGENTS.md`

额外实现要求：

- `graph_build/brainstorm_refresh` 或 `frontier_mapping` 之后生成项目级 `GRAPH_IDEATION_PACKET.json`
- novelty tree 不直接从自由文本生成，而是读取：
  - frontier files
  - anchor index
  - logic/evidence/storyline chain bundle
- challenge-insight tree 先抽 challenge clusters，再抽 insight clusters，最后才写出树
- solution check 必须显式判断 `open / occupied / open_with_constraints`
- top-3 summary 与 tournament 结果必须同步回：
  - `brainstorm_cycle.working_memory`
  - `brainstorm_cycle.reflection_chain`
  - `innovation_reflection`（当与实验后反思有关）
  - `TRACK_REGISTRY.json`

---

## Task 5. 接入 `plan` / `code` / `experiment`

目标：

- 让 proposal 和 story contract 反向约束实现与验证

行为变化：

- `plan` 读取 `RESEARCH_PROPOSAL.md` 和 `PROBLEM_DECOMPOSITION.md`
- `code` 读取 `CLAIM_TO_EXPERIMENT_MAP.md`
- `experiment` / `analyze` 回写 claim 支撑度

文件：

- `skills/orchestrator/plan-research/SKILL.md`
- `skills/coder/implement-experiment/SKILL.md`
- `agents/coder/AGENTS.md`
- `agents/coder/SOUL.md`

---

## Task 6. 接入 `write`

目标：

- 让写作真正贴近 EvoScientist / EvoSkills 的 story-first 方式

行为变化：

- `write` 前必须 ready：
  - story spine
  - pipeline figure sketch
  - module motivation map
  - claim-to-experiment map
  - fallback narrative
  - rejection-risk table

文件：

- `skills/academic_writer/paper-plan/SKILL.md`
- `skills/academic_writer/paper-write/SKILL.md`
- `agents/academic_writer/AGENTS.md`
- `tools/workflow-guard.ts`

---

## Task 7. 接入 `review`

目标：

- 把 Evo 风格的 adversarial paper review 前置成稳定 gate

行为变化：

- `review` 必须补齐：
  - reject-first review
  - novelty attack
  - unsupported claim audit
  - reverse outline
  - figure/table qc
  - limitation audit

文件：

- `skills/reviewer/review-phase/SKILL.md`
- `agents/reviewer/AGENTS.md`
- `tools/workflow-guard.ts`

---

## Task 8. 更新状态展示与文档

目标：

- 让 `/workflow-status` 与文档能直接呈现这些新合同
- 并显示 graph-backed memory 的复用状态，而不是暗示存在另一套独立 memory

文件：

- `tools/workflow-commands.ts`
- `WORKFLOW.md`
- `DOC/reference/skills.md`
- `DOC/reference/agents.md`

---

## 3. 推荐实施顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 6
6. Task 7
7. Task 5
8. Task 8

说明：

- `idea` 和 `write` 是最大收益点，应优先落地
- `plan / code / experiment` 绑定要建立在 story contract 初版 ready 后再加固

---

## 4. 验收标准

- `idea` 阶段不能在缺失 ideation contract 时前进
- `plan` 不能在缺失 research proposal 时前进
- `write` 不能在缺失 story contract 时前进
- `review` 不能在缺失 review pressure packet 时宣告 ready
- `/workflow-status` 能展示三套新状态和其 pending reason
- graph 相关 artifact 真正被用作 ideation / story grounding，而不只是被记录

---

## 5. 风险控制

- 先用 tests 锁 gate，再加实现，避免状态机退化
- 不改变顶层阶段名，减少兼容风险
- 保持旧 artifact 继续可读，逐步把新合同变成硬 gate

---

## 6. 进度快照（2026-04-02）

- `Task 1-3`：已完成
  - durable state、snapshot、tool read/write 已接入
- `Task 4`：已完成主链
  - `materialize_ideation_contract` 已落地，并复用现有 graph / brainstorm / frontier / track memory
  - `IDEA_TREE.md`、`CANDIDATE_POOL.json`、`RANKING_HISTORY.json` 现在显式包含 graph-first 的 tree expansion、`propose -> review -> refine` 和等价 Elo 排名历史
  - `research-ideation` 与更新后的 `idea-tournament` skill 已接入本地 skill 索引和文档
- `Task 6`：已完成主链
  - `materialize_paper_story_state` 已落地，会从 `ideation_contract`、`research_program`、storyline brief 生成 durable story contract
  - analyzer 的 `CLAIM_EVIDENCE_MATRIX.md`、`TRACK_VERDICTS.md`、`UNSUPPORTED_CLAIMS.md` 现在会被吸收到 story contract 的 claim-support snapshot / fallback hooks
  - `runWorkflowAutoIterator` 进入 `code / experiment / analyze / review / write / submit` 时会先做 workflow-owned preflight，缺失或过期的 `paper_story_state` 会自动重建，而不是只等 agent 手动调用 tool
- `Task 7`：已完成主链
  - `materialize_review_pressure_packet` 已落地，会从 `paper_story_state` 与 ideation / baseline 信息生成 durable reviewer pressure packet
  - 本地 `paper-review` skill 已补齐，承接 reject-first / novelty attack / unsupported-claim / reverse outline / limitation audit 的 Evo 风格方法层
  - `runWorkflowAutoIterator` 进入 `review / write / submit` 时会自动补齐或刷新 `review_pressure_packet`，让 writer/reviewer 的 durable pressure artifacts 跟随阶段推进同步更新
- `Task 5`：主链已完成
  - `plan-research`、`implement-experiment`、Coder 文档已切到 proposal / claim-map-first
  - analyze 产出的 claim support / track verdict / unsupported-claim hooks 已能 workflow-owned 地反写回 `paper_story_state`
  - `runWorkflowAutoIterator` 进入 `plan / code / experiment / analyze / review / write / submit` 时会先校正 `ideation_contract`，让 proposal / decomposition / tournament artifacts 作为 workflow-owned stage contract 持续参与闭环
  - 后续还可继续加强更细粒度的 advantage / limitation 自动抽取，但主闭环已打通
- `Task 8`：大体完成
  - `/workflow-status` 与核心 workflow / skill / agent 文档已同步
  - reference 文档已覆盖 analyzer -> paper story 回写主链，以及 `research-ideation` / `paper-review` 的新增支撑
