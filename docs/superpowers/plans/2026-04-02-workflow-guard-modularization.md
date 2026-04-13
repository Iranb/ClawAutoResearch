# workflow-guard 模块化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tools/workflow-guard.ts` 从超大单文件演进成可按 stage、state、materializer、guidance 理解和维护的模块体系。

**Architecture:** 保留 `workflow-guard.ts` 作为 facade，不做一次性重写；优先固化 `workflow-guard-stages/`，随后按 `core -> state -> materializer -> guidance` 顺序迁移实现。所有现有对外调用和测试语义保持兼容。

**Tech Stack:** TypeScript, Node ESM, existing workflow runtime/tests

---

## 备注

- `tools/workflow-commands/` 与旧的 `workflow-guard-modules/` 都是 Claude Ops 协助拆分时留下的目录。
- `workflow-commands/` 已可作为正式拆分参考。
- `workflow-guard-modules/` 已在当前轮次清理，不再作为正式目录保留。
- 2026-04-02 进度快照：
  - 已完成 Task 1。
  - 已完成 Task 2 的首轮拆分：新增 `workflow-guard-core/{coercion,fs,paths,types}`，并为源码测试补齐缺失的 `*.js` shim 入口。
  - 已完成 Task 3 的第二轮拆分：新增 `workflow-guard-state/{research-program,ideation-contract,paper-story,review-pressure,paper-ingestion}`，其中 `paper-ingestion` 的 normalize/serialize/merge helper 已从 facade 迁出。
  - 已完成 Task 3 的第三轮拆分：新增 `workflow-guard-state/writing-contract`，把 writing contract 的默认值、normalize/serialize、template readiness evaluation 和 path resolution 迁出 facade。
  - 已新增 `tools/workflow-background-pool.ts`，把后台 researcher session pool 的 `list/prune/retire/acquire/record` 生命周期接口独立出来；`register-workflow-service.ts` 与 `register-workflow-tools.ts` 已直接依赖该模块，`workflow-fast-paths.ts` 当前保留桥接 wrapper 与队列逻辑。
  - 已完成 Task 5 的首轮拆分：新增 `workflow-guard-summaries/{ideation-contract,paper-story,review-pressure,paper-ingestion,writing-contract}-summary`，`workflow-guard.ts` 中对应公开 summary API 已改成 facade 包装层。
  - 已完成 Task 4：新增 `workflow-guard-materializers/{ideation-contract,paper-story,review-pressure}-materializer`，`workflow-guard.ts` 中三条 `materialize*` 公共 API 均已改成 facade + 依赖注入包装。
  - 已完成 Task 6：新增 `workflow-guard-guidance/{dynamic-tasks,papernexus-guidance,writing-guidance}`，`buildDynamicTasks(...)` 已改成 facade 包装，`papernexus` 与 `writing/reviewer` guidance 已按 concern 拆出。
  - 已完成 Task 7：删除未引用的实验性 `workflow-guard-modules/` 内容，并为 `workflow-commands/` 补充 `README.md` 说明正式职责。
  - 已完成 Task 7 的继续收口：为 `workflow-guard-recorders/` 与 `workflow-guard-runtime/` 增加 `README.md`，把新分层职责文档化。
  - 已完成 Task 8 的本轮收口：删除 `workflow-guard.ts` 中遗留的 ideation legacy materializer 大块实现，并把 `recordCitationVerification / recordIdleResearchRun / recordInnovationReflection / getExperimentMemorySummary / upsertExperimentLedgerEntry` 迁入 `workflow-guard-recorders/state-recorders.ts`，将 `runWorkflowAutoIterator` 主实现迁入 `workflow-guard-runtime/auto-iterator.ts`。
  - 当前文件体量快照：`workflow-guard.ts` 约 `14126` 行；`workflow-fast-paths.ts` 为 `2964` 行；`workflow-background-pool.ts` 为 `910` 行；`workflow-guard-materializers/ideation-contract-materializer.ts` 为 `975` 行；`workflow-guard-recorders/state-recorders.ts` 为 `449` 行；`workflow-guard-runtime/auto-iterator.ts` 为 `665` 行；`workflow-guard-guidance/dynamic-tasks.ts` 为 `135` 行。

## Task 1: 固化 stage 拆分边界

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify/Create: `tools/workflow-guard-stages/`
- Test: `tests/auto-iterator.test.mjs`
- Test: `tests/workflow-commands.test.mjs`
- Test: `tests/workflow-runtime-tools.test.mjs`

- [x] 确认 `getMissingStageSignals(...)` 所有 stage case 已完全外迁到 `workflow-guard-stages/`
- [x] 如果还有残余 stage-specific 逻辑，继续迁出
- [x] 把 `workflow-guard-stages/types.ts` 补齐为稳定接口层
- [x] 跑阶段相关核心回归

Run:
- `node --test tests/auto-iterator.test.mjs tests/workflow-commands.test.mjs tests/workflow-runtime-tools.test.mjs`

Expected:
- PASS，且 `workflow-guard.ts` 中不再保留超长 stage switch 实现

## Task 2: 抽 core helper

**Files:**
- Create: `tools/workflow-guard-core/types.ts`
- Create: `tools/workflow-guard-core/coercion.ts`
- Create: `tools/workflow-guard-core/fs.ts`
- Create: `tools/workflow-guard-core/paths.ts`
- Modify: `tools/workflow-guard.ts`

- [x] 迁移 `pickString` / `pickNumber` / `pickBoolean`
- [x] 迁移 `asRecord` / `asString` / `asStringArray`
- [x] 迁移 `pathExists` / `readTextIfExists` / `readJsonIfExists`
- [x] 迁移 `resolveProjectArtifactPath` / `resolveTrackArtifactPath`
- [x] 迁移 `normalizeStage` 这类无强业务上下文 helper
- [x] 跑 build 和关键测试

Run:
- `npm run build`
- `node --test tests/workflow-guard-boundaries.test.mjs tests/workflow-commands.test.mjs`

Expected:
- PASS，且 facade 中 helper 密度明显下降

## Task 3: 按合同拆 state

**Files:**
- Create: `tools/workflow-guard-state/research-program.ts`
- Create: `tools/workflow-guard-state/ideation-contract.ts`
- Create: `tools/workflow-guard-state/paper-story.ts`
- Create: `tools/workflow-guard-state/review-pressure.ts`
- Create: `tools/workflow-guard-state/paper-ingestion.ts`
- Create: `tools/workflow-guard-state/writing-contract.ts`
- Modify: `tools/workflow-guard.ts`
- Test: `tests/workflow-runtime-tools.test.mjs`

- [x] 把 normalize / serialize / validation helper 按合同迁移
- [x] 先迁最常用的六类 contract
- [x] 保持现有 export 名称兼容
- [x] 更新调用点

Run:
- `node --test tests/workflow-runtime-tools.test.mjs tests/auto-iterator.test.mjs`

Expected:
- PASS，且 `workflow-guard.ts` 中 state contract 逻辑明显减少

## Task 4: 抽 materializer

**Files:**
- Create: `tools/workflow-guard-materializers/ideation-contract-materializer.ts`
- Create: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Create: `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard.ts`

- [x] 抽出 `materializeIdeationContract`
- [x] 抽出 `materializePaperStoryState`
- [x] 抽出 `materializeReviewPressurePacket`
- [x] 校验 runtime tool 入口不变

Run:
- `node --test tests/workflow-runtime-tools.test.mjs tests/workflow-commands.test.mjs`

Expected:
- PASS，runtime tool 仍能正确 materialize 各合同

## Task 5: 抽 summary / status

**Files:**
- Create: `tools/workflow-guard-summaries/ideation-contract-summary.ts`
- Create: `tools/workflow-guard-summaries/paper-story-summary.ts`
- Create: `tools/workflow-guard-summaries/review-pressure-summary.ts`
- Create: `tools/workflow-guard-summaries/paper-ingestion-summary.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/workflow-guard.ts`

- [x] 把 contract 相关 status / summary 函数迁出
- [x] 保证 `/workflow-status` 文案不回归

Run:
- `node --test tests/workflow-commands.test.mjs`

Expected:
- PASS，`/workflow-status` 仍输出完整摘要

## Task 6: 抽 dynamic task / guidance

**Files:**
- Create: `tools/workflow-guard-guidance/dynamic-tasks.ts`
- Create: `tools/workflow-guard-guidance/papernexus-guidance.ts`
- Create: `tools/workflow-guard-guidance/writing-guidance.ts`
- Modify: `tools/workflow-guard.ts`

- [x] 抽出 `buildDynamicTasks(...)`
- [x] 按 concern 再细分 guidance
- [x] 保证动态任务输出与现有 prompt 行为一致

Run:
- `node --test tests/workflow-guard-boundaries.test.mjs tests/workflow-service.test.mjs`

Expected:
- PASS，动态 guidance 不回归

## Task 7: 整理实验性目录

**Files:**
- Review: `tools/workflow-guard-modules/`
- Review: `tools/workflow-commands/`

- [x] 审核 `workflow-guard-modules/` 是否仍有保留价值
- [x] 若无，迁移有效内容后删除
- [x] 若有，按正式目录命名规则并入 `core/state/materializers/guidance`
- [x] 给 `workflow-commands/` 写一份简短 README 或注释说明其职责

Expected:
- guard 相关目录层次变得可解释，不再混杂“正式实现”和“实验性残留”

## Task 8: 最终收口

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `WORKFLOW.md`
- Modify: `DOC/reference/agents.md`

- [x] 继续迁出 state-heavy recorders 与 auto-iterator runtime glue
- [x] 更新文档，说明 guard 新目录结构
- [x] 跑全量相关测试和 build

Run:
- `node --test tests/auto-iterator.test.mjs tests/workflow-commands.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-fast-paths.test.mjs tests/workflow-service.test.mjs tests/workflow-guard-boundaries.test.mjs tests/evo-skill-alignment.test.mjs`
- `npm run build`

Expected:
- PASS
- `workflow-guard.ts` 继续向可读 facade 收口，主循环与 state-heavy recorder 不再内联

## 推荐执行顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8

## 额外约束

- 每完成一个 task 都先跑对应最小测试集
- 不要一边迁 helper 一边改变业务语义
- 不要把 experiment-specific / writing-specific 规则重新堆回 facade
- 如果新模块开始互相环依赖，优先回退边界再拆，而不是继续硬拆
