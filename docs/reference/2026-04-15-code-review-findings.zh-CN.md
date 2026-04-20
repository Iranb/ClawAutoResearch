# openclaw-research Code Review 结论

日期：2026-04-15

## 范围

本次审查覆盖 `openclaw-research` 整个仓库，重点检查：

- workflow runtime / auto iterator / stage preflight 的状态机逻辑
- background session / registry 持久化与并发安全
- survey workflow 路由与产物契约
- dashboard 对 `PROJECTS_STATE.json` 的消费一致性

## 已执行验证

- `npx tsc --noEmit --project tsconfig.json`：通过
- `npm run build`：通过
- `npm run dashboard:test`：通过
- `npm test`：失败，`653` 个测试中 `629` 通过、`24` 失败

失败测试主要集中在：

- `tests/auto-iterator.test.mjs`
- `tests/experiment-auto-review-loop.test.mjs`
- `tests/experiment-decision-routing.test.mjs`
- `tests/workflow-control-plane-phase-3.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-survey-route.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`

这说明问题不是局部样式或单点实现错误，而是集中出现在 workflow 状态机、命令选择优先级、survey 线路和 coordinator 广播链路。

## 结论

建议当前结论为：`REQUEST CHANGES`

原因是存在 4 个 P1 级问题和 1 个 P2 级问题，其中前 4 个都可能导致真实工作流在错误阶段继续推进、错误命令被下发，或后台状态在并发下丢失。

## Findings

### 1. [P1] Experiment routing prefers generic decision text over monitor/review commands

位置：

- `tools/workflow-guard-runtime/auto-iterator.ts:1065-1076`

问题：

- `nextAction` / `resumeAction` 先选 `experimentDecisionCommand`
- 这会把更具体、更高优先级的 `/monitor-experiment` 和 `/experiment-plan` 盖掉
- 当 runtime 已经明确进入 “需要监控远端实验” 或 “需要 reviewed-auto planner 先行” 的状态时，仍可能下发泛化 repair 文案

影响：

- reviewed-auto experiment loop 会走错 owner / wrong command
- monitoring 阶段可能无法显式切到 `/monitor-experiment`
- 与多条失败测试直接对应

建议：

- experiment 阶段的命令优先级必须显式固定为：
  1. gate blocking
  2. monitor command
  3. reviewed-auto review/planning command
  4. generic experiment decision command
  5. stage fallback command

### 2. [P1] Dormant literature-discovery requests are ignored after graph becomes ready

位置：

- `tools/literature-discovery/workflow-bridge.ts:62-86`

问题：

- 只要 graph presence 已是 `ready`
- 且 literature-discovery queued request 仍是“刚入队、尚未启动”的 dormant 状态
- 当前逻辑就把这类请求视为“无须回退到 graph_build”

影响：

- idea / review / write 阶段已经排队了 graph enrichment 工作，但 workflow 不再回退
- stage 可能继续向下推进，而不是等待 graph-backed discovery 完整闭环
- 直接解释多条 `auto iterator ... regress to graph_build` 相关失败

建议：

- 对 workflow-owning 的 discovery request，不应仅因 graph 当前为 `ready` 就视作 inactive
- 只有在 durable state 明确把该请求 reconciliation 到 terminal 状态后，才能停止 graph reentry

### 3. [P1] Survey preflight checks the wrong literature artifact

位置：

- `tools/workflow-guard-runtime/stage-preflight.ts:379-383`
- `tools/workflow-guard-state/survey-review.ts:51-53`

问题：

- survey preflight 使用 `state.literaturePath`
- 默认值是 `researcher/LITERATURE.md`
- 但 survey pipeline / tests / downstream checks 实际使用的是 `researcher/LITERATURE_REVIEW.md`

影响：

- survey 项目即使已经满足写作前置条件，也可能被错误判定为缺文件
- 从而反复 rematerialize `survey_review`
- survey line 的写作推进被错误阻塞

建议：

- 统一 survey canonical artifact：
  - synthesis / survey review 主文档使用 `researcher/LITERATURE_REVIEW.md`
- state defaults、preflight、materializer、tests 必须同一次修改同步更新

### 4. [P1] Background run registry update is not serialized

位置：

- `tools/workflow-background-pool.ts:601-613`
- `tools/workflow-background-pool.ts:379-407`

问题：

- background registry 使用无锁的 read-modify-write
- 写文件虽然是 atomic write，但整个事务并不具备并发安全
- 两个并发 background run / reconcile 流程可能读到同一快照并互相覆盖

影响：

- 丢失 background session 记录
- pooled session 容量判断可能失真
- runtime recovery / prune / retire 的行为可能不稳定

建议：

- registry mutation 必须放进统一 advisory lock 或等价的事务性 project-scoped store 更新中
- 不能只靠 atomic write

### 5. [P2] Dashboard discovery ignores PROJECTS_STATE.dir

位置：

- `apps/workflow-dashboard/server/file-access/project-discovery.ts:28-41`
- 对照实现：`tools/workflow-project-registry.ts:111-112, 186-193`

问题：

- dashboard 仅根据 `projects[].id` 推导 `projectRoot`
- 但 registry writer 和 coordinator 已经把 `projects[].dir` 作为正式位置字段使用

影响：

- 当 `dir` 与 `id` 不一致时
- service 层和 dashboard 层会看到不同的项目路径
- operator 看到的项目列表可能丢失或误指向

建议：

- 所有 `PROJECTS_STATE.json` 消费方统一遵守：
  - 优先 `dir`
  - `id` 仅作为 fallback

## 推荐修复顺序

1. 修复 experiment command priority
2. 修复 literature-discovery graph reentry 判定
3. 修复 survey preflight artifact path
4. 为 background run registry 引入串行化写入
5. 统一 dashboard 的 `PROJECTS_STATE.dir` 解析逻辑

## 修复后建议回归测试

- `node --test tests/auto-iterator.test.mjs`
- `node --test tests/experiment-auto-review-loop.test.mjs`
- `node --test tests/experiment-decision-routing.test.mjs`
- `node --test tests/workflow-control-plane-phase-3.test.mjs`
- `node --test tests/workflow-service.test.mjs`
- `node --test tests/workflow-survey-route.test.mjs`
- `node --test tests/workflow-writing-lines-e2e.test.mjs`
- `npm run dashboard:test`
- `npm run build`

## 面向后续修改者的原则

- 状态机类修改必须先确认 command priority，而不是只看 `nextAction` 文案
- workflow-owned queued request 不能因为“当前看起来 ready”就被静默吞掉
- canonical artifact path 必须由 state defaults、preflight、materializer、tests 共同维护
- 带 registry 的持久化更新默认按并发场景设计，禁止无锁 read-modify-write
- `PROJECTS_STATE.json` 的读取语义必须在 dashboard / service / test helper 之间保持一致
