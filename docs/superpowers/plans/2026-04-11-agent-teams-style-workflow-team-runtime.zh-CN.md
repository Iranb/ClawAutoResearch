# Workflow Pipeline 重构与 Agent Teams Runtime 实施计划

> **Status:** IMPLEMENTED — CORE RUNTIME, PRODUCTION RECOVERY, AND SURVEY-LINE HARDENING LANDED

> **For agentic workers:** 这份计划不是“继续往现有系统上加层”的指令，而是“先收束 pipeline 内核，再把 Agent Teams 风格推进机制落到新内核上”的重构路线。任何实现都必须先补回归，再做最小可逆变更，并优先删除重复表达而不是继续堆逻辑。

**Goal:** 基于当前 `openclaw-research` 的真实代码结构，重构 workflow pipeline，把当前分散在 `workflow-guard`、`register-workflow-tools`、`register-workflow-service`、`workflow-fast-paths`、`workflow-handoff-runtime`、`snapshot-builder` 等处的决策、执行、协作、投影逻辑收束成统一内核；在这个基础上，把当前仍缺失的 top-tier evidence moat 机制变成 first-class workflow contracts，最后再把 stage 内推进升级成 Claude Agent Teams 风格的共享 task graph、claim/lease、completion gate 与 idle continuation。

**Architecture:** 不替换现有 stage truth，不推翻 durable workflow facts。保留 `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`GATE_STATE.json`、`EXPERIMENT_LEDGER.json` 与 `auto_iterator_tick` 作为阶段真相源；重点重构“谁决定下一步”“谁执行派发”“谁维护协作状态”“谁生成 snapshot / dashboard 读模型”这几层的边界。与此同时，把 benchmark protocol lock、statistical evidence、venue competition、ablation/mechanism evidence、reproducibility pack、camera-ready evidence pack、top-tier bet gating 做成 workflow-owned contracts，而不是散落在 skill、prompt、review 备注中的软约束。Team Runtime 不直接建立在今天分散的 service/fast-path/mailbox 实现之上，而是建立在统一的 Workflow Kernel 与 Evidence Kernel 之上。

**Tech Stack:** TypeScript、Node.js built-in test runner、现有 workflow runtime state 文件、dashboard 读模型、OpenClaw plugin/tool/service/hook 入口。

**Progress Snapshot (2026-04-11):**

- 已完成切片 A：引入 `tools/workflow-kernel/graph-context.ts`，把 `auto_iterator` 的 graph-sensitive refresh / routing / repair 判断统一到 graph context adapter；新增 `tests/workflow-kernel-refactor.test.mjs`，并通过 `tests/auto-iterator.test.mjs` 全量回归。
- 已完成切片 B：引入 `tools/workflow-evidence/papernexus-bridge.ts`，把 stage-preflight 对 workflow-owned PaperNexus packet/bundle 的存在性判断收束到统一 bridge；新增 `tests/workflow-evidence-kernel.test.mjs`。
- 已完成切片 C：引入最小 evidence contract state schema（template blocks + normalizer + snapshot/status projection），使 `benchmark_protocol`、`statistical_evidence`、`venue_competition`、`ablation_evidence`、`mechanism_evidence`、`reproducibility_pack`、`camera_ready_evidence`、`opportunity_scorecard` 成为真正可见的 workflow state；新增 snapshot/status 回归。
- 已完成切片 D：将 `worth_top_tier_bet` 路径下的最小 top-tier gate 接入 `write/submit` 阶段信号，要求 `venue_competition` 与 `opportunity_scorecard` 的 graph context 不能处于 `unverified_graph_context` / `graph_unavailable`；新增 auto-iterator 回归验证。
- 已完成切片 E：将 `worth_top_tier_bet` 路径下的最小 top-tier experiment gate 接入 `experiment -> analyze`，要求 `benchmark_protocol`、`statistical_evidence`、`ablation_evidence` 不能缺失；新增 auto-iterator 回归验证。
- 已完成切片 F：将 `worth_top_tier_bet` 路径下的最小 top-tier analyze gate 接入 `analyze -> review`，要求 `mechanism_evidence` 与 `venue_competition` 的 graph context 不能处于 `unverified_graph_context` / `graph_unavailable`；新增 auto-iterator 回归验证。
- 已完成切片 G：将 `worth_top_tier_bet` 路径下的最小 reproducibility / camera-ready gate 接入 `write -> submit` 与 `submit`，要求 `reproducibility_pack` 至少进入可用状态，且 `camera_ready_evidence` 的 figures/tables/captions 状态达到 ready；新增 auto-iterator 回归验证。
- 已完成切片 H：引入 evidence closeout summary，把分散的 evidence contract 状态聚合成 snapshot/status 可消费的统一输出，用于后续 closeout packet 与 Team Runtime 任务分解。
- 已完成切片 I：引入最小 `workflow-team/stage-profiles.ts`，基于 `evidence closeout summary` 生成 stage task preview，并接入 snapshot 与 `/workflow-status`，作为 Team Runtime 的第一刀语义层。
- 已完成切片 J：引入最小 `workflow-team/task-graph.ts`，把 `stage task preview` 落盘为 project-local task graph store，并把摘要接进 snapshot 与 `/workflow-status`，作为后续 claim/lease 的持久化底座。
- 已完成切片 K：在 `workflow-team/task-graph.ts` 上引入最小 `claim / renew / release` 语义，并把 claimed 数量接进 snapshot 与 `/workflow-status`，作为后续 service-side Team Runtime 消费的最小 ownership 底座。
- 已完成切片 L：让 `maybeLaunchAutoStageForProject(...)` 在真实 auto-stage dispatch 成功后尝试从 task graph 中为目标 owner session 自动 claim 下一任务，形成第一条真正消费 task graph + claim state 的 continuation 流。
- 已完成切片 M：引入 `workflow-team/team-round.ts`，把当前 stage 的 lead、task graph 摘要、active session 和 last claimed task 落盘，并在 auto-stage dispatch claim 成功后自动维护 team round。
- 已完成切片 N：让 tool 侧 `maybeDispatchAutoIteratorTask(...)` 也在 dispatch 成功后消费 task graph + claim state，至此 auto iterator 的 tool/service 两条主要 handoff 路都已开始依赖 Team Runtime state。
- 已完成切片 O：dashboard/read-model 开始读取 `top-tier verdict`、`team round`、`task graph` 摘要，Team Runtime 与 Evidence Runtime 已进入项目详情主摘要层。
- 已完成切片 P：引入 runtime-session 驱动的 claim 回收链路，当 session 进入 `completed / failed / needs_repair` 时自动释放 task claim 与 team round session，避免任务永久卡死在 `claimed`。
- 已完成切片 Q：修复 channel-project binding 的跨进程缓存一致性问题，binding index 现在会在文件 mtime 变化后主动失效并重读，不再单纯依赖 30s 内存 TTL；新增 stale-cache 回归测试。
- 已完成切片 R：提取 `workflow-kernel/readiness.ts` 与 `workflow-kernel/stage-registry.ts`，把 research-program onboarding/plan validation、innovation reflection、brainstorm validation、stage lead / team-runtime support policy 收束为共享 kernel；`workflow-guard.ts` 与 `snapshot-builder.ts` 已改为消费这些共享 helper。
- 已完成切片 S：提取 `workflow-collaboration/{mailbox,contacts,handoff-policy}.ts`，让 workflow mailbox、contact cooldown、auto-iterator mailbox handoff 的 durable 操作有统一内核入口；`workflow-handoff-runtime.ts` 已改走这些 collaboration surface。
- 已完成切片 T：提取 `workflow-execution/{runtime-store,delivery-adapter,background-pool,dispatch-plan,transition-orchestrator}.ts`，并将 service/tool 主路径改走 execution kernel façade；`Lobster` 的角色现在被明确收口在 delivery adapter 层。
- 已完成切片 U：引入 `workflow-team/task-hooks.ts`，补齐 `claim -> verify -> satisfied/needs_repair -> auto-claim next` 的稳定闭环；`research_workflow` 新增 `get_task_graph / get_team_round / claim_task / renew_task_lease / release_task / complete_task` 等 runtime surface。
- 已完成切片 V：task graph 扩展为 richer runtime store，支持 `dependsOn`、`verificationStatus`、`latestEvent`、`verifying`、`needs_repair`，并把这些状态接入 snapshot、`/workflow-status`、team round、dashboard detail。
- 已完成切片 W：service-side pooled session 从 researcher-only 扩展到 role-aware，auto-stage / auto-discussion / mitigation 主路径已能为 `orchestrator / coder / analyzer / academic_writer / reviewer / researcher` 复用同一套 pooled session policy。
- 已完成切片 X：dashboard 项目详情页已增加 Team Round 概览、Task Board 与 Evidence Moat 概览；新增 `workflow-collaboration-kernel`、`workflow-execution-kernel`、`workflow-task-claim`、`workflow-team-recovery` 回归测试。
- 当前实现分支：`codex/workflow-kernel-graph-context`
- 当前状态：Evidence Runtime、Team Runtime 的核心运行面、Role-aware session pool、Dashboard 可观察性、长 EXEC guardrail、PaperNexus 失败论文顺序 retry 接口、feature flag、heartbeat idle continuation、evidence materializer module 分层与主要验证矩阵已经落地；最新 survey / review-paper 流水线 hardening 也已落地。

---

## 0. 2026-04-11 覆盖度审计与新增 TODO

这次审计结论是：当前分支已经实现了大量核心功能，但不能再把整份计划标成“全部完成”。更准确的描述是：

- **已完成核心功能闭环**：Evidence contracts、top-tier gates、task graph store、claim/lease/release、`complete_task` 后续 claim、dashboard task/evidence 可视化、binding coherency、Lobster delivery-adapter 边界。
- **已补齐严格 TODO 主线**：新增 exec packet、PaperNexus failed-paper retry、Team Runtime policy gate、heartbeat idle continuation、evidence materializer modules 与 projection model；旧大文件仍保留兼容 façade，但主入口已有明确 kernel surface。
- **新增两个真实运行问题必须进入计划**：
  - 长 EXEC 指令会触发 OpenClaw obfuscation guard，并且 Discord 无法做 chat exec approval。
  - PaperNexus 上传失败后缺少 first-class “失败论文重复上传/顺序重提交”接口，导致 `graph_build` 容易卡在人工对话和权限不一致里。

### 0.1 当前已真实覆盖

- `tools/workflow-kernel/graph-context.ts`
  - 已统一 `graph_build / frontier_mapping / idea` 等 graph-sensitive 阶段的 graph context 判断。
  - 已接入 `auto_iterator` 的 graph refresh、graph re-entry、repair routing。
- `tools/workflow-evidence/papernexus-bridge.ts`
  - 已把 workflow-owned PaperNexus packet/bundle 检查从 stage-preflight 中抽出。
- `tools/workflow-evidence/contracts.ts`
  - 已让 `benchmark_protocol`、`statistical_evidence`、`venue_competition`、`ablation_evidence`、`mechanism_evidence`、`reproducibility_pack`、`camera_ready_evidence`、`opportunity_scorecard` 成为可读 workflow state。
- `tools/workflow-evidence/closeout-summary.ts`
  - 已提供统一 evidence closeout summary。
- `tools/workflow-guard-stages/execution-stage-signals.ts`
  - 已把 top-tier `experiment -> analyze`、`analyze -> review` 证据 gate 接入 stage missing signals。
- `tools/workflow-guard-stages/writing-stage-signals.ts`
  - 已把 top-tier `write -> submit` / `submit` 的 reproducibility / camera-ready / graph-grounded 证据 gate 接入。
- `tools/workflow-team/task-graph.ts`
  - 已支持 task graph 持久化、claim、renew、release、lease expiry reconcile、dependency-aware claim、`verifying`、`needs_repair`、latest event。
- `tools/workflow-team/task-hooks.ts`
  - 已支持 `claim -> verify -> satisfied/needs_repair -> auto-claim next`。
- `tools/register-workflow-tools.ts`
  - 已新增 `get_task_graph`、`get_team_round`、`claim_task`、`renew_task_lease`、`release_task`、`complete_task`。
- `tools/register-workflow-service.ts`
  - 已在 auto-stage dispatch 成功后消费 task graph，并在 runtime session terminal 后释放 claims。
  - pooled session policy 已从 researcher-only 扩展到 role-aware。
- `apps/workflow-dashboard`
  - 项目详情页已显示 Team Round、Task Board、Evidence Moat。
- `tools/channel-project-bindings.ts`
  - 已通过 mtime invalidation 修复 binding index stale cache 问题。
- `tools/workflow-execution/delivery-adapter.ts`
  - 已把 Lobster 定位为 optional delivery adapter，不是 workflow truth source。

### 0.2 审计后补齐结果

- **Execution Kernel**
  - 已新增 `exec-budget.ts` / `exec-packet.ts`，并接入 `agent-task-dispatch.ts` 与 `workflow-fast-paths.ts`。
  - 已新增 execution façade：`runtime-store.ts`、`delivery-adapter.ts`、`background-pool.ts`、`dispatch-plan.ts`、`transition-orchestrator.ts`。
  - 旧 runtime 文件继续保留以维持兼容；新入口不再需要散落理解 Lobster/native/background pool。
- **Projection Kernel**
  - 已新增 `workflow-projection/model.ts` 和 `dashboard-summary.ts`。
  - Dashboard detail 已消费 projection summary；snapshot/status 保留兼容 re-export surface。
- **Fact Kernel**
  - 已新增 readiness/stage-registry，并由 `workflow-guard.ts` / `snapshot-builder.ts` 消费。
  - `workflow-guard.ts` 仍大，但关键重复 helper 已迁移；后续只做维护性 shrink，不再阻塞本计划。
- **Evidence materializers**
  - 已新增 `benchmark-registry.ts`、`protocol-lock.ts`、`statistics.ts`、`venue-competition.ts`、`ablation-sufficiency.ts`、`mechanism-packet.ts`、`reproducibility-pack.ts`、`camera-ready-pack.ts`、`opportunity-model.ts`。
- **TeammateIdle / completion**
  - `complete_task` 已提供 verify/satisfy/repair/auto-claim-next。
  - `before_prompt_build` heartbeat 已实现 idle continuation：空闲 heartbeat 可自动 claim 下一 task，并注入 continuation guidance。
- **Task state migration**
  - `completed` 被兼容映射到 `satisfied`，`blocked` 被兼容映射到 dependency-aware `claimable`。
- **Team Runtime feature flag**
  - `workflowPolicy.teamRuntime.enabled` 已加入 policy，auto-iterator materialization、tool task actions、service auto-claim 均已尊重该开关。

### 0.3 新增真实问题 A：长 EXEC 指令触发 OpenClaw 封控

#### 现象

用户在 Discord 中触发较长执行指令时，OpenClaw 返回：

```text
Obfuscated command detected: Command too long; potential obfuscation
Exec approval is required, but chat exec approvals are not enabled on Discord.
Approve it from the Web UI or terminal UI, or enable Discord, Slack, or Telegram exec approvals.
```

#### 根因判断

- agent / workflow runtime 把过长的执行说明、脚本、命令、或多步骤 EXEC payload 直接塞进 chat/dispatch command。
- OpenClaw 的 obfuscation guard 将 “command too long” 视为潜在混淆命令。
- Discord 当前无法完成 chat exec approval，导致执行无法继续。
- 这与 Team Runtime 的 task graph 无关，是 **Execution Kernel / Delivery Adapter / Prompt Budget** 的边界问题。

#### 设计原则

- workflow 不应该要求 Discord 前台消息承载长 EXEC 命令。
- 长命令必须转成 durable command packet、project-local script、runtime queue payload、或 tool action 参数。
- agent dispatch message 只能包含短指令与 artifact reference。
- 对 OpenClaw exec guard 友好：短命令、无混淆、多行脚本落文件、带 checksum/idempotency key。

#### TODO A1：新增 EXEC payload budget policy

- Create: `tools/workflow-execution/exec-budget.ts`
- Add:
  - `MAX_CHAT_EXEC_COMMAND_CHARS`
  - `MAX_DISPATCH_COMMAND_CHARS`
  - `MAX_BACKGROUND_COMMAND_CHARS`
  - `MAX_INLINE_SYSTEM_PROMPT_CHARS`
  - `isWorkflowCommandTooLong(commandText)`
  - `summarizeExecPayloadForDispatch(commandText)`
  - `buildExecPayloadBudgetDiagnostic(...)`
- Acceptance:
  - 任何进入 `sessions_send` / `sessions_spawn` / background run message 的 command 都先过 budget check。
  - 超过阈值时不再把原始命令发到 Discord / chat runtime。

#### TODO A2：新增 file-backed exec packet

- Create: `tools/workflow-execution/exec-packet.ts`
- Durable path:
  - `{PROJ}/.openclaw-research/exec-packets/{packetId}.json`
  - `{PROJ}/.openclaw-research/exec-packets/{packetId}.sh`
- Packet schema:
  - `packetId`
  - `projectId`
  - `stage`
  - `ownerRole`
  - `createdAt`
  - `commandSummary`
  - `commandText`
  - `scriptPath`
  - `sha256`
  - `requiresApproval`
  - `approvalSurface`
  - `idempotencyKey`
  - `expectedOutputs`
  - `rollbackHint`
- Behavior:
  - Long command becomes script file + JSON packet.
  - Dispatch message includes only:
    - packet path
    - checksum
    - short run command or workflow tool action
  - No full script is pasted into Discord.

#### TODO A3：改造 dispatch / background builders

- Modify:
  - `tools/agent-task-dispatch.ts`
  - `tools/workflow-fast-paths.ts`
  - `tools/register-workflow-tools.ts`
  - `tools/register-workflow-service.ts`
  - `tools/workflow-execution/delivery-adapter.ts`
- Required changes:
  - `buildWorkflowDispatchMessage(...)` 对 command/extraBody 做 length budget。
  - `startBackgroundWorkflowRun(...)` 对 `message` / `extraSystemPrompt` 做 length budget。
  - `handoffWorkflowTaskToAgent(...)` 传给 Lobster/native 的 command 也必须走同一 budget logic。
  - `run_papernexus_wrapper` / `start_background_run` 如果 command 太长，自动 materialize exec packet。
- Acceptance:
  - 长命令不会触发 `Obfuscated command detected`。
  - Discord 中只出现短、可读、可审计的 command reference。

#### TODO A4：新增 guard-specific failure recovery

- Add detection:
  - `/Obfuscated command detected/i`
  - `/Command too long/i`
  - `/exec approvals are not enabled/i`
- Modify:
  - `workflow-runtime-maintenance`
  - `workflow-runtime-recovery`
  - `workflow-fast-paths`
- Behavior:
  - 捕获该错误后，不再重试同一个长命令。
  - 自动生成 `exec_packet_required` repair action。
  - 将 queue/session 标为 `needs_repair`，并给出短指令：
    - “Run materialized exec packet from Web UI/terminal UI”
    - 或 “Re-dispatch with file-backed packet”

#### TODO A5：测试

- Add:
  - `tests/workflow-exec-budget.test.mjs`
  - `tests/workflow-runtime-tools.test.mjs` 新增 long command regression
  - `tests/agent-task-dispatch.test.mjs` 新增 long dispatch payload regression
  - `tests/workflow-fast-paths.test.mjs` 新增 background long command regression
- Tests:
  - long command becomes exec packet
  - dispatch message does not contain full long command
  - obfuscated command error produces repair action
  - short command remains inline

### 0.4 新增真实问题 B：PaperNexus 失败论文缺少重复上传接口

#### 现象

用户要求 Researcher 重提交 33 篇失败论文。系统出现了多轮不稳定行为：

- 一开始 agent 声称已启动批量顺序重提交，并给出 `/tmp/papernexus-resubmit.log`。
- 随后另一个/后续 Researcher 会话没有 `research_workflow` 工具，只能看到 `papernexus-remote__*`。
- agent 又要求用户手动运行 `/graph-build` / `/resume-pipeline` 或授权 SSH。
- 用户明确要求重新提交失败论文，但 workflow 没有 first-class retry/resubmit action。

#### 根因判断

- `paper_ingestion` 可以记录 queued/completed/failed，但没有专门的 “failed items retry manifest + sequential resubmit” workflow action。
- 失败原因是 PaperNexus 并发竞态：
  - `Source inputs changed`
  - `Another PaperNexus run committed newer corpus state`
- 系统缺少对这类 failure signature 的可恢复分类。
- 前台 Researcher session 和后台 workflow session 的工具可用性不一致。
- 运行时把“谁负责准备”和“谁有工具执行”混在自然语言里，导致 handoff 不确定。

#### 设计原则

- 失败论文重提交必须是 workflow-owned tool action，不应靠 agent 手写 `/tmp/*.log` 或 SSH。
- Researcher 是 `graph_build` 的 manifest owner，但执行必须走 workflow runtime/service 或 PaperNexus wrapper。
- 如果当前 foreground session 没有 `research_workflow`，系统应产生明确 handoff/dispatch，而不是让用户选择 A/B。
- 对竞态失败默认采用 sequential retry，避免再次并发冲突。

#### TODO B1：扩展 paper ingestion failure state

- Modify:
  - `tools/workflow-guard-state/paper-ingestion.ts`
  - `templates/PROJECT_MANIFEST.json`
- Add fields:
  - `failed_papers`
  - `retryable_failed_papers`
  - `non_retryable_failed_papers`
  - `last_failure_scan_at`
  - `last_retry_manifest_path`
  - `retry_policy`
  - `retry_run_id`
  - `retry_status`
  - `retry_attempt_count`
  - `sequential_retry_interval_seconds`
- Failure item schema:
  - `paperId`
  - `title`
  - `sourceKey`
  - `inputPath`
  - `failureSignature`
  - `failureMessage`
  - `failedAt`
  - `retryable`
  - `retryReason`
  - `alreadyInGraph`
  - `lastRetryAt`
  - `retryCount`

#### TODO B2：新增 PaperNexus failure classifier

- Create: `tools/workflow-evidence/papernexus-failure-classifier.ts` or `tools/paper-ingestion-failures.ts`
- Classify retryable signatures:
  - `Source inputs changed`
  - `Another PaperNexus run committed newer corpus state`
  - transient HTTP / timeout / lock conflict
- Classify non-retryable signatures:
  - invalid markdown
  - missing source path
  - unsupported file type
  - parser validation failed
- Acceptance:
  - 33 篇竞态失败会被标为 `retryable`.
  - 已经存在于 graph 的论文不再重复提交，标为 `already_in_graph`.

#### TODO B3：新增 retry manifest materializer

- Create: `tools/paper-ingestion-retry-materializer.ts`
- Durable output:
  - `{PROJ}/graph/FAILED_PAPER_RETRY_MANIFEST.json`
  - `{PROJ}/graph/FAILED_PAPER_RETRY_REPORT.md`
- Manifest fields:
  - `corpus`
  - `retryMode: sequential`
  - `intervalSeconds`
  - `maxAttempts`
  - `items[]`
  - `sourceIndexSnapshot`
  - `graphPresenceSnapshot`
  - `createdBy`
  - `createdAt`
- Acceptance:
  - retry manifest is deterministic and idempotent.
  - rerunning materializer does not duplicate already queued retry items.

#### TODO B4：新增 workflow tool actions

- Modify: `tools/register-workflow-tools.ts`
- Add actions:
  - `get_paper_ingestion_failures`
  - `classify_paper_ingestion_failures`
  - `materialize_paper_ingestion_retry`
  - `queue_paper_ingestion_retry`
  - `get_paper_ingestion_retry_status`
  - `cancel_paper_ingestion_retry`
- Behavior:
  - `queue_paper_ingestion_retry` creates/updates queued request with `pn_batch_import.py`.
  - Retry request must use sequential mode.
  - Default interval should be configurable, initial default 45s.
  - Tool returns exact retry manifest path and queue key.
- Acceptance:
  - User can say “重新提交 33 篇失败论文”，Researcher can call one workflow action instead of inventing shell/SSH steps.

#### TODO B5：新增 service-side fallback when foreground lacks `research_workflow`

- Modify:
  - `tools/register-workflow-service.ts`
  - `tools/register-workflow-hooks.ts`
  - `tools/workflow-handoff-runtime.ts`
- Behavior:
  - If current session lacks `research_workflow` but role is owner, create a runtime queue entry targeted at the workflow-capable researcher session.
  - User should not need to manually run `/graph-build` or SSH.
  - System emits mailbox/handoff:
    - “Retry manifest prepared”
    - “Workflow-capable session must run queue_paper_ingestion_retry”
- Acceptance:
  - Foreground tool mismatch no longer blocks retry.

#### TODO B6：Graph presence integration

- Before retry:
  - run graph presence check for failed items.
  - remove items already present in graph.
- During retry:
  - mark `retry_status=running`.
  - persist `owner_run` progress in `PAPERNEXUS_PROGRESS.json`.
- After retry:
  - run graph presence refresh.
  - move successful items to completed.
  - leave remaining failures classified.
- Acceptance:
  - `graph_build` can advance after retry completes or after all remaining failures are non-blocking/already-in-graph.

#### TODO B7：Tests

- Add:
  - `tests/paper-ingestion-retry.test.mjs`
  - `tests/workflow-runtime-tools.test.mjs` retry action cases
  - `tests/auto-iterator.test.mjs` graph_build retry gate cases
  - `tests/workflow-service.test.mjs` service fallback cases
- Test scenarios:
  - 33 retryable failures produce sequential retry manifest.
  - already-in-graph failed items are skipped.
  - foreground session without workflow tool queues retry handoff to workflow-capable session.
  - race-condition failures are retried with sequential interval.
  - invalid markdown failures are non-retryable and produce repair guidance.

### 0.5 Strict Coverage TODO 总表

- [x] **TODO-1: Deep Execution Kernel Extraction**
  - Move `BackgroundWorkflowQueueRunPayload`, `BackgroundWorkflowQueueDispatchPayload`, `BackgroundWorkflowQueueEntry`, registry read/write, queue drain/retry, runtime fallback from `workflow-fast-paths.ts` into `workflow-execution`.
  - Make `workflow-fast-paths.ts` only build requests/commands and call execution kernel.
  - Shrink target: remove at least 600 lines from `workflow-fast-paths.ts`.
  - Tests: `workflow-fast-paths.test.mjs`, `workflow-execution-kernel.test.mjs`, `workflow-runtime-orchestrator.test.mjs`.
- [x] **TODO-2: True Projection Kernel**
  - Create canonical `WorkflowProjectionModel`.
  - Make snapshot, `/workflow-status`, dashboard detail, dashboard overview consume this model.
  - Stop dashboard from directly stitching manifest + incidental files except inside projection kernel.
  - Tests: snapshot/status/dashboard golden projection.
- [x] **TODO-3: Hook-level TaskCompleted / TeammateIdle**
  - Add hook integration in `register-workflow-hooks.ts`.
  - Detect claimed task at stop/idle.
  - Run verification.
  - If failed, block idle and return repair reason.
  - If passed, complete and auto-claim next.
  - Tests: hook prompt isolation + task continuation.
- [x] **TODO-4: Team Runtime Feature Flag**
  - Add policy flag, e.g. `workflowPolicy.teamRuntime.enabled`.
  - Gate task graph materialization, claim, complete_task, dashboard task board, service auto-claim.
  - Add disabled-mode regression: old stage handoff path still works.
- [x] **TODO-5: Evidence Materializers**
  - Split evidence runtime into planned files:
    - `benchmark-registry.ts`
    - `protocol-lock.ts`
    - `statistics.ts`
    - `venue-competition.ts`
    - `ablation-sufficiency.ts`
    - `mechanism-packet.ts`
    - `reproducibility-pack.ts`
    - `camera-ready-pack.ts`
    - `opportunity-model.ts`
  - Each module owns schema, materializer, validation, and degrade reason.
- [x] **TODO-6: Task State Naming Migration**
  - Decide whether final state is `completed` or `satisfied`.
  - Decide whether dependency-derived blocked should become explicit `blocked`.
  - If renaming:
    - add migration for old task graph stores.
    - update dashboard labels.
    - update tests.
- [x] **TODO-7: Long EXEC Guardrail**
  - Implement exec budget and file-backed exec packet.
  - Stop sending long commands through Discord dispatch.
  - Add obfuscation error recovery.
- [x] **TODO-8: PaperNexus Failed Upload Retry Interface**
  - Implement failure classifier, retry manifest, workflow tool actions, service fallback, graph presence integration.
  - Make “重提交失败论文” a first-class workflow action.

### 0.6 新增真实问题 C：综述项目被实验论文流水线吞掉

#### 现象记录

项目：

- `gcd-survey-tpami-2026`
- 项目路径：`/workspace/AutoResearchProjects/gcd-survey-tpami-2026`
- 用户明确说明：“综述不需要 idea phase”
- 用户要求启动 `/paper-plan` 并开启全自动模式

实际日志暴露了几个连续故障：

1. Workflow 先广播：
   - `frontier mapping -> idea`
   - `next_action: run /innovation-reflection first; then run /idea-phase`
   - 这说明当时 workflow 走的是实验论文 ideation 主线，而不是 survey 主线。
2. Researcher 之后手动表示：
   - `paper_type: unset -> survey`
   - `stage: idea -> plan`
   - 这说明 survey identity 没有在 workflow truth 里提前锁定，而是由 agent 在对话中补救。
3. 用户启动 `/paper-plan` 后触发长 EXEC 封控：
   - `Obfuscated command detected: Command too long`
   - 说明 paper-plan / auto-mode 启动路径还可能把过长执行文本送进 Discord-visible exec surface。
4. 后续 Researcher/Coder 试图通过补 stub 的方式穿过实验论文主线：
   - plan 生成随机 track id
   - plan -> code
   - code innovation review gate
   - code -> experiment
   - experiment cooldown
   - 手动 manifest stage 改写被 auto iterator 回滚
5. Coder 最终报告：
   - code artifacts 已补齐
   - code review 通过
   - workflow 仍回退到 `graph_build`
   - `paper_ingestion.graph_presence_status` 被 tick 后覆盖为 `missing_sources`

#### 代码证据

当前代码中已经有 survey line routing，但它依赖 `isSurveyWorkflow(manifest)` 能在 tick 前识别 survey：

- `tools/workflow-line-routing.js`
  - `isSurveyWorkflow(...)` 会检查：
    - `workflow_line`
    - `project_type`
    - `paper_type`
    - `writing_contract.paperMode`
    - `survey_review`
    - `project_id` 是否包含 `survey`
    - `research_program.goal/problem_statement` 是否包含 survey / literature review / systematic review / 综述
  - `resolveStageForWorkflowLine(...)` 会把 survey 项目的 `setup / graph_build / frontier_mapping / idea / plan / code / experiment / analyze / review` 统一恢复成 `survey_review`
  - `resolveNextStageForWorkflow(...)` 对 survey 项目应走：
    - recovery stages -> `survey_review`
    - `survey_review -> write`
    - `write -> submit`
    - `submit -> done`
- `tools/workflow-guard-runtime/auto-iterator.ts`
  - tick 开始时会先读 manifest，然后如果 `deps.isSurveyWorkflow(manifest)` 为 true，才会调用 `resolveStageForWorkflowLine(...)`
  - 如果 manifest 没有被识别为 survey，就会继续使用实验论文阶段机。
- `tools/workflow-guard-policies/role-policy.ts`
  - `STAGE_REQUIREMENTS` 仍包含实验主线 `plan -> code -> experiment -> analyze -> review -> write`
  - survey 只有独立 `survey_review -> write`

#### 根因判断

这不是单一 bug，而是 **survey identity lock 缺失 + survey route 不够强制 + agent 手动改状态破坏 durable truth** 的组合问题。

根因 1：Survey identity 没有在项目创建/graph_build 早期成为 durable truth

- 日志里 Researcher 说 `paper_type unset -> survey`，说明关键 survey marker 是在 workflow 已经进入 `idea` 后才被补上。
- 如果 `PROJECT_MANIFEST.json.project_id`、`paper_type`、`workflow_line`、`writing_contract.paper_mode`、`survey_review.status/topic` 任一关键字段缺失，旧版本或当前不完整状态都可能被当作实验论文处理。

根因 2：`/paper-plan` 没有被映射到 survey-native stage

- 用户说 `/paper-plan`，Researcher 将其解释为综述大纲规划。
- 旧版本 workflow 阶段机可能把它映射到 `plan`，而不是 `survey_review` 或 `write_package`。
- 一旦进入 `plan`，就会触发实验论文 `research_program.plan_selection` / `tracks` / `task_graph` 约束。

根因 3：实验论文 stage gates 对 survey 项目没有强制 bypass

- 进入 `code` 后，系统要求：
  - `coder/experiments/.../train.py`
  - `EXPERIMENT_MANIFEST.json`
  - `coder/EXPERIMENT_INDEX.md`
  - code innovation review gate
- 进入 `experiment` 后，又要求实验结果、ledger、analysis readiness。
- 对综述论文，这些都是错误的 stage gates。

根因 4：Auto iterator 是 durable truth，手动改 manifest 会被回滚

- Coder 尝试手动改 `current_stage` 跳过 code/experiment。
- 但 auto iterator 下一次会重新根据 graph presence、missingStageSignals、gate state、owner/stage truth 计算，导致回滚。
- 这说明“手动改 stage”不是安全恢复路径，必须提供 workflow-owned survey skip/recovery action。

根因 5：Graph presence 与 survey route 耦合不清

- Coder 报告 `paper_ingestion.graph_presence_status` 被覆盖为 `missing_sources`。
- 对 survey 项目，graph presence 仍然重要，但 graph repair 完成后应有明确的 `check_graph_presence / refresh_graph_presence / accept_remote_graph_ready` workflow action。
- 不能让 agent 通过手动写 manifest 来宣称 ready。

#### 修复状态

已在当前分支补齐：

- `tools/workflow-line-routing.js`
  - 新增 `ensureSurveyWorkflowIdentity(...)`，把 survey identity 持久化为 `workflow_line=survey`、`paper_type=survey`、`writing_contract.paper_mode=survey`、`survey_review.topic/status/current_phase`。
- `tools/workflow-guard-runtime/auto-iterator.ts`
  - 在 tick 早期执行 survey identity lock，并在 stage preflight 前保存，避免 materializer 读取旧 manifest。
- `tools/workflow-guard-project-state.ts`
  - survey bootstrap 现在会写入 `workflow_line=survey` 与 `paper_type=survey`。
- `tools/workflow-guard-materializers/survey-review-materializer.ts`
  - survey materializer 现在锁定 survey writing contract，并生成 `researcher/SURVEY_OUTLINE.md` / `SURVEY_OUTLINE.packet.json`。
- `tools/workflow-guard-stages/survey-stage-signals.ts`
  - survey stage signal 已拆成独立模块。
- `tools/register-workflow-hooks.ts`
  - `/paper-plan` 在 survey 项目中注入 survey-native planning guidance，禁止进入实验 plan/code/experiment。
  - workflow prompt 会提示不要手动改 `current_stage`，应使用 `recover_survey_route` / `materialize_survey_review_state`。
- `tools/register-workflow-tools.ts`
  - 新增 `refresh_graph_presence` / `accept_remote_graph_ready` aliases。
  - 新增 `recover_survey_route` / `skip_experiment_stages_for_survey` workflow-owned recovery actions。
- `tools/workflow-guard-setters/research-state-setters.ts`
  - `set_orchestration_state` 对 survey 项目的 `next_transition_candidate=code/experiment/analyze/idea/plan` 会修正为 `survey_review`。
- `tests/workflow-survey-route.test.mjs`
  - 覆盖 survey 项目从 `frontier_mapping` 恢复到 `survey_review`、完成 survey review 进入 `write`、生成 survey outline、拦截 survey -> code mutation。

#### 为什么旧版本框架会出现综述流程问题

旧版本即使已有 `isSurveyWorkflow`，仍可能在以下条件下复现：

- `project_id` 没有持久化为 `gcd-survey-tpami-2026`，或者 runtime 读到的是另一个 project/root。
- `paper_type` / `workflow_line` / `writing_contract.paper_mode` 没有在 project-init 阶段写入 manifest。
- `/paper-plan` 仍调用实验论文 `plan` 阶段工具，而不是 survey-native `survey_review`。
- auto-mode service 根据 `drive_stage` dispatch，而不是根据 `workflow_line=survey` 改写到 survey route。
- graph presence remote 状态修复后没有通过 workflow-owned graph presence refresh 重新落盘。
- foreground agent 手动修改 manifest，触发 auto iterator 在下一轮按旧 truth 回滚。

#### Survey 流水线目标设计

综述论文应明确走独立主线：

```text
setup -> graph_build -> frontier_mapping -> survey_review -> write -> review/surface_qc -> submit -> done
```

其中：

- `idea`：默认跳过，除非用户显式要求“提出原创实验方向”。
- `plan`：不应复用实验论文 plan gate；应映射成 survey outline planning。
- `code`：默认跳过。
- `experiment`：默认跳过。
- `analyze`：默认跳过实验 analysis；survey 可选使用 literature synthesis / taxonomy analysis。
- `review`：可保留为 survey manuscript review / coverage review，而不是实验 code/research review。

#### DONE C1：Survey identity lock

- Modify:
  - project init / bind / survey init paths
  - `templates/PROJECT_MANIFEST.json`
  - `tools/workflow-line-routing.js`
- Add durable fields:
  - `workflow_line: "survey"`
  - `paper_type: "survey"`
  - `writing_contract.paper_mode: "survey"`
  - `survey_review.status`
  - `survey_review.topic`
  - `survey_review.target_venue`
- Acceptance:
  - 一旦 project id、topic、user command、writing contract 任一信号表明 survey，workflow 必须持久化 survey identity。
  - 后续 tick 不再回到实验论文 `idea / plan / code / experiment / analyze`。

#### DONE C2：Survey route hardening in auto_iterator

- Modify:
  - `tools/workflow-guard-runtime/auto-iterator.ts`
  - `tools/workflow-line-routing.js`
- Required behavior:
  - 如果 `isSurveyWorkflow(manifest)` 为 true，并且 `current_stage` 属于 `idea / plan / code / experiment / analyze / review`，auto iterator 必须：
    - set `stageAfter = survey_review` 或 survey-specific stage
    - set owner = `researcher`
    - clear experiment-only next_action
    - emit reason: `survey_route_recovery`
  - 不允许 survey 项目生成：
    - `/idea-phase`
    - experiment track repair
    - code experiment bundle handoff
    - code innovation review gate
    - experiment monitor gate
- Acceptance:
  - `frontier_mapping` 完成后的 survey 项目进入 `survey_review`，不是 `idea`。

#### DONE C3：`/paper-plan` 映射为 survey-native planning

- Modify:
  - command parser / prompt fast path / workflow tools
  - `register-workflow-hooks.ts`
  - `register-workflow-tools.ts`
- Behavior:
  - 对 survey 项目，`/paper-plan` 应 materialize:
    - survey outline
    - taxonomy plan
    - coverage matrix
    - section responsibility map
  - 不应调用实验论文 `plan` stage validator。
- Acceptance:
  - 用户说“启动 /paper-plan”不会进入 `plan -> code`。

#### DONE C4：Survey-specific stage signals

- Create:
  - `tools/workflow-guard-stages/survey-stage-signals.ts`
- Survey `survey_review` required signals:
  - `researcher/SURVEY_TAXONOMY.md`
  - `researcher/SURVEY_COVERAGE_MATRIX.json`
  - `researcher/SURVEY_OUTLINE.md`
  - `researcher/SURVEY_READING_MATRIX.json`
  - graph-grounded coverage status
  - target venue / paper mode
- Survey `write` required signals:
  - survey outline locked
  - coverage matrix ready
  - citation collection ready
  - section packet plan ready
- Bypass:
  - code experiment bundle
  - experiment ledger
  - multi-seed statistics
  - ablation evidence
  - mechanism evidence, unless explicitly configured for survey+experiment hybrid

#### DONE C5：Survey auto-mode gate bypass

- Modify:
  - code review auto gate
  - experiment launch/review gate
  - auto-mode discussion / mitigation dispatch
- Behavior:
  - Survey route should not run code innovation review.
  - Survey route should not require experiment launch approval.
  - Survey route can run survey quality review:
    - coverage sufficiency
    - taxonomy coherence
    - citation integrity
    - novelty of survey perspective
- Acceptance:
  - aggressive auto-mode on survey does not dispatch Coder for experiment bundle unless explicitly configured as hybrid.

#### DONE C6：Graph presence recovery action for survey

- Add tool action:
  - `refresh_graph_presence`
  - `accept_remote_graph_ready`
  - or extend `check_graph_presence` with `persist=true`
- Behavior:
  - 当用户说“远程 Graph 状态修复完成”，Researcher 应调用 workflow-owned graph refresh action。
  - 不允许手动改 `paper_ingestion.graph_presence_status`。
  - If remote graph is ready, persist:
    - `graph_presence_status=ready`
    - `graph_presence_checked_at`
    - `graph_presence_present_papers`
    - `graph_presence_missing_papers=[]`
- Acceptance:
  - 修复远程 graph 后，下一次 tick 不会重新覆盖为 `missing_sources`，除非远程检查确实失败。

#### DONE C7：Manual stage mutation guard

- Modify:
  - prompt guidance
  - tool guards
  - maybe `set_orchestration_state`
- Behavior:
  - Agent 不应直接改 `PROJECT_MANIFEST.json.current_stage` 来跳过阶段。
  - 如果需要跳过，必须调用 workflow-owned action:
    - `recover_survey_route`
    - `skip_experiment_stages_for_survey`
    - `auto_iterator_tick` with survey recovery
- Acceptance:
  - Coder 不会再创建 stub `train.py` / fake experiment manifest 作为 survey 跳关手段。

#### DONE C8：Tests for survey route

- Add:
  - `tests/workflow-survey-route.test.mjs`
  - `tests/auto-iterator.test.mjs` survey regressions
  - `tests/workflow-runtime-tools.test.mjs` `/paper-plan` survey mapping
  - `tests/workflow-hook-prompt-isolation.test.mjs` survey guidance
- Test cases:
  - `project_id=gcd-survey-tpami-2026` with `frontier_mapping` advances to `survey_review`, not `idea`.
  - `paper_type=survey` and `current_stage=plan` recovers to `survey_review`, not `code`.
  - `workflow_line=survey` bypasses code/experiment/analyze gates.
  - `/paper-plan` creates survey outline artifacts, not experiment plan state.
  - remote graph ready persistence prevents regression to `graph_build`.
  - manual stage mutation is rejected or repaired through survey recovery.

#### Immediate operator guidance

如果线上再次发生同类问题，正确操作顺序应是：

1. 不要手动改 `current_stage`。
2. 先确保 manifest 有：
   - `workflow_line=survey`
   - `paper_type=survey`
   - `writing_contract.paper_mode=survey`
   - `survey_review.topic`
3. 运行 workflow-owned graph presence refresh，而不是手写 `graph_presence_status`.
4. 运行 survey recovery / auto iterator，让 stage 回到 `survey_review`.
5. 在 `survey_review` 里生成 survey outline / taxonomy / coverage matrix。
6. 再进入 `write`。

---

## 1. 为什么上一个版本还不够

上一个版本的核心假设是：

- 保留当前 pipeline
- 在当前 pipeline 下增加一层 Team Runtime

这个方向本身没有错，但它低估了当前代码面的一个更根本问题：

- **当前系统的复杂度不只是“少了 task graph”，而是 pipeline 内核本身已经分散且重复。**

如果不先收束 pipeline 内核，而是直接把 Team Runtime 加进去，结果大概率会是：

- stage truth 仍在一套逻辑里
- dispatch / background / pool / mailbox 又在另一套逻辑里
- task graph 再来第三套逻辑
- dashboard 再单独读第四套状态

这会让系统比现在更难维护。

所以这次 plan 的主张是：

1. 先重构 pipeline 内核
2. 再在新内核上落 Agent Teams 式 stage runtime

---

## 2. 基于当前代码库的诊断结论

下面的判断不是抽象建议，而是基于当前 workflow 相关代码面的具体分析。

### 2.1 当前 workflow 的真实形态

从 docs/architecture/workflow-control-plane.md 可以确认：

- 系统当前明确是“durable state + workflow code 决定下一步”
- `auto_iterator_tick` 是最核心的执行入口
- 当前 handoff 是 `drive_stage` 级别，不是 task graph 级别

从 tools/workflow-guard-runtime/auto-iterator.ts 可以确认：

- dispatchable action 的选择仍然是从 `recommendedActions` 中选一个 `drive_stage`
- 当前系统能表达的主线动作还是：
  - `wait_human`
  - `drive_stage`
  - `background`

这说明当前 pipeline 的最小推进单元仍然是 stage action，而不是共享 task。

### 2.2 代码面上的核心问题不是“缺一个 task board”，而是“内核职责混杂”

关键文件体量：

- `tools/workflow-guard.ts`: **9384** 行
- `tools/register-workflow-tools.ts`: **2906** 行
- `tools/register-workflow-service.ts`: **4320** 行
- `tools/workflow-fast-paths.ts`: **3312** 行
- `tools/workflow-guard-project/snapshot-builder.ts`: **1651** 行
- `tools/register-workflow-hooks.ts`: **897** 行

这些数字本身不等于设计错误，但在当前仓库里，它们确实对应了明显的职责叠加。

### 2.3 已经可以确认的重复表达

#### A. `workflow-guard.ts` 与 `snapshot-builder.ts` 存在重复域逻辑

同名或同职责 helper 已经在两个地方重复出现，例如：

- `formatWorkflowShellArgument`
- `getResearchProgramOnboardingGaps`
- `getResearchProgramOnboardingStatus`
- `getResearchProgramPlanValidationErrors`
- `isInnovationReflectionDue`
- `getBrainstormCycleValidationErrors`

可见：

- workflow-guard.ts
- snapshot-builder.ts

这意味着当前“workflow fact / validation / projection”并没有共享同一个真正的 domain kernel。

#### B. execution/runtime 数据结构在多个文件重复建模

`WorkflowRuntimeQueueDispatchPayload` 与 `WorkflowRuntimeQueueEntry` 已经在 workflow-runtime-state.ts 定义，但 `workflow-fast-paths.ts` 里又有一套 `BackgroundWorkflowQueueDispatchPayload` / `BackgroundWorkflowQueueEntry`。

而 `acquireBackgroundWorkflowSession`、`recordBackgroundWorkflowRun` 等能力又在：

- workflow-background-pool.ts
- workflow-fast-paths.ts
- register-workflow-service.ts

之间反复穿透。

这说明当前 execution kernel 是分裂的。

#### C. mailbox / handoff / dispatch 链路被拆散在多个文件

当前 handoff 相关逻辑分散在：

- `tools/workflow-guard-collaboration.ts`
- `tools/workflow-handoff-runtime.ts`
- `tools/agent-task-dispatch.ts`
- `tools/lobster-handoff.ts`
- `tools/register-workflow-hooks.ts`
- `tools/register-workflow-service.ts`

其中：

- mailbox enqueue/ack 在 collaboration/runtime 两边都有参与
- dispatch 既可 native，又可 lobster，又和 mailbox ack 绑定
- hook 层还会自动 ack handoff mailbox

这条链已经具备能力，但边界并不清晰。

#### D. stage 定义分散，导致“阶段是什么”不是一个单一对象

今天一个 stage 的语义散在：

- `ROLE_POLICIES` / `STAGE_REQUIREMENTS`
- `auto_iterator`
- `stage-preflight`
- `stage-specific signals`
- `dynamic tasks`
- service 的 auto launch 策略
- dashboard 的 summary projection

也就是说，当前系统缺一个真正的 `StageDefinition`/`StageRuntimeDefinition`。

### 2.4 当前设计里真正应该保留的部分

这些不是问题，反而是这次重构必须保留的骨架：

- `PROJECT_MANIFEST.json` 仍然是 stage / owner / next_action / blocking_reason 的真相源
- `auto_iterator_tick` 仍然是阶段推进与回退的判定器
- runtime queue / sessions / announce / broadcast 已经 durable 化
- mailbox 作为 structured handoff / blocker / request / note 是合理的
- dashboard 是读模型，不应变成写控制面

### 2.5 从 `top-tier-paper-gap-analysis.md` 反推出来的结构性缺口

docs/reference/top-tier-paper-gap-analysis.md 提醒了一点：即使我们把 kernel 收束了、把 Team Runtime 做出来了，系统仍然未必能稳定产出 top-tier 论文。因为现在缺的不只是“更好的 handoff”，而是若干 **workflow-owned evidence contracts**。

结合当前代码面，可以看到这些缺口已经有一些零散前置能力，但还不是一等公民：

- **Benchmark registry / protocol lock**
  - 现在 `research_program` 已经有 baseline / dataset / metric 字段，templates/PROJECT_MANIFEST.json。
  - survey 线也已经有 benchmark alignment 字段，survey-review.ts。
  - 但没有 benchmark object model、protocol lock file、protocol drift detection。

- **Statistical evidence**
  - 现在 analyze/review 技能会谈 significance，review rubric 也有 `significance` 字段，authoring-review-state.ts。
  - 但没有 workflow-owned statistical aggregation materializer，也没有把多 seed 结果稳定升级成 claim-strength gate。

- **Venue-competitive novelty / competitor slate**
  - 现在有 novelty tree、novelty attack、venue routing、review pressure。
  - 但没有 target-venue competitor slate、acceptance-risk scorecard、venue-specific novelty kill-switch。

- **Ablation sufficiency / mechanism evidence**
  - `research_program` 已有 `required_ablations`，research-program.ts。
  - execution state 也已有 `ablationSummaryPath`，execution-state.ts。
  - 但没有“ablation sufficiency evaluator”，也没有从 ablation -> causal mechanism 的 workflow contract。

- **Release-grade reproducibility**
  - 现在有 remote run metadata、experiment ledger、git-aware candidate/incumbent control。
  - 但没有 reproducibility pack / supplementary bundle contract / reproduce-on-commit 验证。

- **Camera-ready evidence presentation**
  - 现在已有 `write_package`、`paper_qc`、`figure_qc`，templates/PROJECT_MANIFEST.json templates/PROJECT_MANIFEST.json templates/PROJECT_MANIFEST.json。
  - 但没有从 results -> stats tables -> figures -> captions -> camera-ready section packets 的一体化 materializer。

- **Top-tier bet / opportunity model**
  - 现在 graph-backed ideation 已经很强，也有 venue fit hints。
  - 但没有明确的 “not worth a top-tier bet” kill gate，也没有 target-venue opportunity model。

### 2.6 更新后的总体判断

**结论：**

- 只做 additive Team Runtime：**不够合理**
- 先重构 pipeline kernel，再落 Team Runtime：**合理**
- 只做 kernel 重构，不把 top-tier evidence loops 变成 first-class contracts：**仍然不够**
- 重写整个 workflow fact model：**不合理**

---

## 3. 新的设计裁决

### 3.1 不再把“Team Runtime”当作唯一目标

新的主目标分成三层：

1. **Workflow Pipeline Kernel Refactor**
2. **Top-Tier Evidence Contracts**
3. **Agent Teams Style Stage Runtime**

第一层解决：

- 决策逻辑重复
- 执行逻辑重复
- 协作逻辑重复
- 投影逻辑重复

第二层解决：

- benchmark protocol lock
- statistical evidence
- venue-competitive positioning
- ablation sufficiency
- mechanism evidence
- reproducibility pack
- camera-ready evidence pack
- top-tier bet gating

第三层才解决：

- task graph
- claim / lease
- completion gate
- idle continuation

### 3.2 目标架构

重构后的 pipeline 应该收束成 6 个内核层：

#### Layer A: Workflow Fact Kernel

职责：

- stage registry
- stage owner / next stage
- readiness
- rollback / regression
- closeout eligibility

它是今天 `workflow-guard.ts + stage-preflight + stage signals + derived-state` 的统一内核。

#### Layer B: Workflow Collaboration Kernel

职责：

- mailbox
- contact cooldown
- handoff policy
- blocker/request/note lifecycle

它是今天 `workflow-guard-collaboration.ts + workflow-handoff-runtime.ts + handoff rules` 的统一内核。

#### Layer C: Workflow Execution Kernel

职责：

- runtime queue / session / announce / broadcast
- dispatch plan
- background pool
- pooled session lease
- native/lobster delivery adapter

它是今天 `workflow-runtime-state.ts + workflow-session-orchestrator.ts + workflow-fast-paths.ts + workflow-background-pool.ts + lobster-handoff.ts + agent-task-dispatch.ts` 的统一内核。

### 3.2.1 Lobster 的定位

`Lobster` 应明确视为 **Execution Kernel 内的可选 delivery adapter**，而不是：

- workflow truth source
- project binding source
- Team Runtime state source

因此本计划对 `Lobster` 的裁决是：

- **应该继续保留并纳入 delivery-adapter 统一收束**
- **不应让 Lobster 负责 project binding 解析**
- **不应让 Lobster 单独定义 handoff 是否成功**
- **应让 Lobster 消费 task graph / claim state，而不是反过来定义它们**

换句话说：

- `Lobster` 解决的是 handoff transport / orchestration backend
- binding coherency 解决的是 project resolution / runtime visibility

两者相关，但不是同一层问题。

#### Layer D: Workflow Projection Kernel

职责：

- snapshot builder
- status formatter
- dashboard read models
- runtime health projection

它是今天 `snapshot-builder.ts + workflow-commands/formatters.ts + dashboard read-models` 的统一内核。

### 3.2.2 Binding Coherency 是独立工作流面

当前系统必须把下面这个问题当成独立目标，而不是顺带靠其它重构“自然解决”：

- bind/unbind 文件写入成功后，tool / hook / service / snapshot 解析是否能立即看到最新 binding

这条工作流面与 Team Runtime 同样重要，因为：

- 如果 project resolution 不稳定，后续 task graph / team round / evidence gate 可能落在错误项目上
- 它不是 handoff transport 问题，而是 runtime state visibility 问题

因此本计划将 `Binding Coherency` 视为：

- Workflow Collaboration Kernel 与 Execution Kernel 之间的基础一致性要求
- 其成功标准是“fresh binding 在下一次解析时可见”，而不是“30s 内缓存最终会过期”

#### Layer E: Workflow Evidence Kernel

职责：

- benchmark registry / protocol lock
- statistical aggregation / significance artifacts
- venue competitor slate / novelty scorecard
- ablation sufficiency evaluator
- mechanism evidence packet
- reproducibility pack
- camera-ready evidence pack
- top-tier bet / opportunity model

这一层的目标不是替代 `research_program`、`experiment_review_state`、`paper_story_state`、`paper_qc`、`figure_qc`，而是给它们提供更强、更可验证的 evidence contracts。

#### Layer F: Workflow Team Runtime

职责：

- stage-scoped task graph
- claim / lease
- task completion verification
- teammate idle continuation

这一层建立在 A/B/C 上，不直接旁路它们。

### 3.3 PaperNexus 依赖分层

这次重构必须把 `PaperNexus` 的作用写清楚，否则很容易出现两种坏结果：

- 该依赖图谱的时候没依赖，最后把 novelty / venue competition / mechanism positioning 做成“无图猜测”
- 不该依赖图谱的时候过度依赖，导致本地实验、统计、复现、camera-ready 流程被外部图谱耦死

这份 plan 对 PaperNexus 的裁决是：

#### A. **必须依赖 PaperNexus 的地方**

- `graph_build`
- `frontier_mapping`
- `idea`
- top-tier path 下的 `venue_competition`
- top-tier path 下的 `opportunity_scorecard`
- graph-grounded `competitor slate`
- graph-grounded `mechanism prior` / cross-domain mechanism sourcing

这些地方如果没有 PaperNexus 或等价 graph context，就不应声称：

- novelty 已充分 grounding
- competitor slate 已充分建立
- venue-competitive positioning 已充分完成
- top-tier bet 已被认真评估

#### B. **建议用 PaperNexus 辅助，但本地证据仍是主事实源的地方**

- `benchmark_protocol`
  - 用于发现 benchmark family、常见 protocol variants、nearest comparison setup
  - 但最终 protocol lock 必须落在项目本地 contract 中
- `mechanism_evidence`
  - 用于发现先验机制、相近解释、相关 failure mode
  - 但真正的 mechanism evidence 仍必须由本地 ablation / intervention / analyzer packet 支撑
- `ablation_evidence`
  - 用于生成 reviewer-objection -> required ablation set 的候选映射
  - 但 sufficiency 最终要看本地实验结果
- `review_pressure_packet`
  - 可吸收 graph-backed novelty attack / competitor objection / venue expectations
  - 但最终 review verdict 仍由本地 evidence packet 决定
- `paper_story_state`
  - 可吸收 graph-backed related-work / gap / claim support context
  - 但正文 claim 不能只靠 graph 先验，仍要落到本地实验与分析

#### C. **不应该依赖 PaperNexus 的地方**

- `statistical_evidence`
- `reproducibility_pack`
- `camera_ready_evidence`
- execution kernel 的 queue/session/dispatch
- team runtime 的 claim/lease/idle continuation
- compile / figure placement / caption formatting / supplementary bundle assembly

这些环节应该以项目本地 artifacts 为唯一权威来源。PaperNexus 可以提供背景，但不能变成真相源。

#### D. **降级策略必须明确**

如果 PaperNexus 不可用，系统应做的是：

- 对 graph-sensitive 阶段：明确阻塞或降级，不伪装成 graph-grounded
- 对 evidence contracts：
  - `venue_competition`
  - `opportunity_scorecard`
  - graph-backed `mechanism_evidence`
  
  标记为 `unverified_graph_context` / `graph_unavailable`
- 对本地实验、统计、复现、camera-ready 流程：继续允许执行
- 对最终 top-tier bet 结论：禁止给出“已通过高标准新颖性/竞争性评估”的正向结论

---

## 4. 明确哪些东西不该重构

### 4.1 不重构 stage truth

不要把下面这些迁走：

- `PROJECT_MANIFEST.json.current_stage`
- `PROJECT_MANIFEST.json.owner_agent`
- `PROJECT_MANIFEST.json.next_action`
- `PROJECT_MANIFEST.json.blocking_reason`

### 4.2 不把 mailbox 改造成 task board

理由：

- mailbox 当前有自动 ack
- mailbox 语义是消息，不是 DAG
- mailbox item 没有 lease / dependency / verify policy

### 4.3 不把 runtime queue 改造成 task graph

理由：

- queue 表达的是 run/dispatch intent
- task graph 需要长期状态、依赖、claim、reopen

### 4.4 不第一步就全量 team 化所有 stage

理由：

- 当前 pipeline 内核还没收束
- 如果先全量 team 化，只会把重复逻辑扩散到更多 stage

### 4.5 不把 top-tier evidence loops 塞回旧状态块里

理由：

- `research_program` 适合承载问题、track、baseline、metric、required ablations 的 program-level contract，不适合继续塞 benchmark lock、statistical aggregation、venue competition、repro pack、camera-ready pack。
- `experiment_review_state` 适合承载 pre-launch review round，不适合膨胀成整个 evidence moat registry。
- `paper_story_state`、`review_pressure_packet`、`paper_qc`、`figure_qc` 应消费 evidence contracts，而不应自己充当这些 contracts 的唯一真相源。

因此这次重构应新增独立 evidence contracts，而不是继续把所有能力塞回既有 manifest 块中。

---

## 5. 重构后的模块边界

### 5.1 建议新增的目录结构

#### `tools/workflow-kernel/`

- `stage-registry.ts`
- `graph-context.ts`
- `readiness.ts`
- `transitions.ts`
- `closeout.ts`
- `stage-actions.ts`

#### `tools/workflow-collaboration/`

- `mailbox.ts`
- `contacts.ts`
- `handoff-policy.ts`
- `handoff-runtime.ts`

#### `tools/workflow-execution/`

- `runtime-store.ts`
- `dispatch-plan.ts`
- `delivery-adapter.ts`
- `background-pool.ts`
- `transition-orchestrator.ts`

#### `tools/workflow-projection/`

- `snapshot.ts`
- `status-text.ts`
- `dashboard-summary.ts`
- `runtime-health.ts`

#### `tools/workflow-evidence/`

- `papernexus-bridge.ts`
- `benchmark-registry.ts`
- `protocol-lock.ts`
- `statistics.ts`
- `venue-competition.ts`
- `ablation-sufficiency.ts`
- `mechanism-packet.ts`
- `reproducibility-pack.ts`
- `camera-ready-pack.ts`
- `opportunity-model.ts`

#### `tools/workflow-team/`

- `team-round.ts`
- `task-graph.ts`
- `task-claim.ts`
- `task-hooks.ts`
- `stage-profiles.ts`

### 5.2 现有文件的角色变化

- `tools/workflow-guard.ts`
  - 变成 facade，不再承载大量业务 helper
- `tools/register-workflow-tools.ts`
  - 只保留 tool action registration 与 adapter glue
- `tools/register-workflow-service.ts`
  - 只保留 service polling / scheduling glue
- `tools/workflow-fast-paths.ts`
  - 拆掉 background queue/store/pool 细节，只保留 slash-command background request builder
- `tools/workflow-guard-project/snapshot-builder.ts`
  - 改成纯 projection adapter
- `tools/register-workflow-hooks.ts`
  - 改成 hook adapter，不直接承载 handoff/runtime 事实

---

## 6. 重构优先级判断

### Priority 0: 先锁行为

在任何重构前，先把以下测试当成保护网：

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-fast-paths.test.mjs`
- `tests/workflow-runtime-orchestrator.test.mjs`
- `tests/workflow-guard-snapshot-builder.test.mjs`
- `tests/lobster-handoff.test.mjs`
- `tests/agent-task-dispatch.test.mjs`

### Priority 1: 先收束重复，不先加新能力

先做：

- kernel extraction
- duplicated helper elimination
- runtime payload unification
- collaboration boundary clarification

再做：

- top-tier evidence contracts
- Team Runtime

### Priority 2: 先把 top-tier evidence loops 做成 workflow contracts

优先顺序直接沿用 `top-tier-paper-gap-analysis.md` 的 leverage 判断：

1. benchmark registry + protocol lock
2. statistical aggregation + confidence artifacts
3. venue-competitive novelty / competitor scorecard
4. ablation sufficiency + mechanism evidence
5. release-grade reproducibility pack
6. camera-ready evidence materialization
7. top-tier bet / opportunity kill gate

### Priority 3: Team Runtime 只 pilot 到少数阶段

首批只 pilot：

- `experiment`
- `analyze`
- `review`

---

## 7. Planned File Map

### New files

- `tools/workflow-kernel/stage-registry.ts`
- `tools/workflow-kernel/graph-context.ts`
- `tools/workflow-kernel/readiness.ts`
- `tools/workflow-kernel/transitions.ts`
- `tools/workflow-kernel/closeout.ts`
- `tools/workflow-collaboration/mailbox.ts`
- `tools/workflow-collaboration/contacts.ts`
- `tools/workflow-collaboration/handoff-policy.ts`
- `tools/workflow-execution/runtime-store.ts`
- `tools/workflow-execution/dispatch-plan.ts`
- `tools/workflow-execution/delivery-adapter.ts`
- `tools/workflow-execution/background-pool.ts`
- `tools/workflow-execution/transition-orchestrator.ts`
- `tools/workflow-projection/snapshot.ts`
- `tools/workflow-projection/status-text.ts`
- `tools/workflow-evidence/papernexus-bridge.ts`
- `tools/workflow-evidence/benchmark-registry.ts`
- `tools/workflow-evidence/protocol-lock.ts`
- `tools/workflow-evidence/statistics.ts`
- `tools/workflow-evidence/venue-competition.ts`
- `tools/workflow-evidence/ablation-sufficiency.ts`
- `tools/workflow-evidence/mechanism-packet.ts`
- `tools/workflow-evidence/reproducibility-pack.ts`
- `tools/workflow-evidence/camera-ready-pack.ts`
- `tools/workflow-evidence/opportunity-model.ts`
- `tools/workflow-team/team-round.ts`
- `tools/workflow-team/task-graph.ts`
- `tools/workflow-team/task-claim.ts`
- `tools/workflow-team/task-hooks.ts`
- `tools/workflow-team/stage-profiles.ts`
- `tests/workflow-kernel-refactor.test.mjs`
- `tests/workflow-execution-kernel.test.mjs`
- `tests/workflow-collaboration-kernel.test.mjs`
- `tests/workflow-evidence-kernel.test.mjs`
- `tests/workflow-team-runtime.test.mjs`
- `tests/workflow-task-claim.test.mjs`
- `tests/workflow-team-recovery.test.mjs`

### Modified files

- `tools/workflow-guard.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-fast-paths.ts`
- `tools/workflow-background-pool.ts`
- `tools/workflow-runtime-state.ts`
- `tools/workflow-handoff-runtime.ts`
- `tools/workflow-guard-collaboration.ts`
- `tools/agent-task-dispatch.ts`
- `tools/lobster-handoff.ts`
- `tools/workflow-guard-project/snapshot-builder.ts`
- `tools/register-workflow-hooks.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/papernexus-progress.ts`
- `tools/papernexus-packets/materializer.ts`
- `tools/workflow-guard-policies/role-policy.ts`
- `tools/workflow-guard-stages/execution-stage-signals.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- `tools/workflow-guard-materializers/paper-story-materializer.ts`
- `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- `tools/workflow-guard-writing/paper-quality-eval.ts`
- `tools/workflow-guard-writing/citation-theory-eval.ts`
- `templates/PROJECT_MANIFEST.json`
- `tools/workflow-commands/formatters.ts`
- `apps/workflow-dashboard/server/read-models/project-detail.ts`
- `apps/workflow-dashboard/server/read-models/project-overview.ts`
- `apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx`
- 对应测试与文档

### Deletion / Shrink Targets

- `tools/workflow-guard.ts` 目标降到 facade 规模，不再承载重复 validation/snapshot helper
- `tools/workflow-fast-paths.ts` 删除 background store/pool 的重复实体定义
- `tools/register-workflow-service.ts` 删除 handoff/runtime 执行细节，只保留 service glue
- `tools/workflow-guard-project/snapshot-builder.ts` 删除与 `workflow-guard.ts` 重复的域 helper

---

## 8. Task 1: 锁定 pipeline 重构的行为边界

**目标：** 先证明重构不会改写 stage truth、dispatch truth 和 dashboard truth。

**Files:**

- Create: `tests/workflow-kernel-refactor.test.mjs`
- Modify: 现有 workflow 核心测试套件

- [x] **Step 1: 写失败测试，锁定 stage truth 仍由 auto iterator 决定**

覆盖：

- `stageAfter`
- `ownerAfter`
- rollback / regression
- gate blocking
- closeout eligibility

- [x] **Step 2: 写失败测试，锁定 mailbox / queue / dashboard 各自职责不变**

覆盖：

- mailbox 仍是 handoff/blocker/request/note
- runtime queue 仍是 dispatch/background intent
- dashboard 仍是只读 projection

- [x] **Step 3: 写失败测试，锁定 native / lobster fallback 不回归**

---

## 9. Task 2: 提取 Workflow Fact Kernel

**目标：** 先解决 `workflow-guard.ts` 与 `snapshot-builder.ts` 的重复域逻辑问题。

**Files:**

- Create: `tools/workflow-kernel/stage-registry.ts`
- Create: `tools/workflow-kernel/graph-context.ts`
- Create: `tools/workflow-kernel/readiness.ts`
- Create: `tools/workflow-kernel/transitions.ts`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/papernexus-progress.ts`
- Modify: `tools/papernexus-packets/materializer.ts`

- [x] **Step 1: 抽出 StageDefinition / StageRegistry**

统一承载：

- owner
- nextStage
- stage line
- stage closeout contract
- team runtime support policy

- [x] **Step 2: 把重复 helper 收束进 Fact Kernel**

优先迁移重复 helper：

- onboarding gaps/status
- plan validation
- brainstorm validation
- innovation reflection due
- shell argument / stage command helpers

- [x] **Step 3: 让 auto iterator / snapshot / stage-preflight 都依赖同一套 kernel**

目标：

- 不再各自复制 stage judgment
- 不再各自复制 validation helper

- [x] **Step 4: 抽出统一的 graph context adapter，明确 PaperNexus 只作为 graph-sensitive 输入层**

要求：

- `graph_build` / `frontier_mapping` / `idea` 相关判断统一通过 `graph-context.ts`
- 统一消费：
  - graph presence
  - PaperNexus progress
  - packet materialization
  - graph freshness / refresh required
- 不让 domain kernel 直接散落调用多种 PaperNexus helper
- graph context 输出必须区分：
  - `ready`
  - `stale`
  - `missing`
  - `unavailable`

当前进展：

- 已完成：`graph-context.ts` 已落地，`auto_iterator` 已改走统一 graph context，并通过回归测试。
- 已补齐：`auto_iterator` 与 stage-preflight 的主要 graph-sensitive 判断已统一到 `graph-context` / `papernexus-bridge`；`papernexus-progress` / packet materializer 侧保留兼容入口。

### 9.1 合理性判断

这一步是 **高价值且低争议** 的，因为当前重复已经是明牌问题。

---

## 10. Task 3: 提取 Workflow Collaboration Kernel

**目标：** 把 mailbox / contact cooldown / handoff policy 从当前分散的实现中收束出来。

**Files:**

- Create: `tools/workflow-collaboration/mailbox.ts`
- Create: `tools/workflow-collaboration/contacts.ts`
- Create: `tools/workflow-collaboration/handoff-policy.ts`
- Modify: `tools/workflow-guard-collaboration.ts`
- Modify: `tools/workflow-handoff-runtime.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `tools/register-workflow-service.ts`

- [x] **Step 1: mailbox/store 操作统一到 collaboration kernel**

包括：

- read/write mailbox
- enqueue
- ack
- dedupe

- [x] **Step 2: contact cooldown 统一到 collaboration kernel**

不再让 hooks/service/tool 各自理解联络语义。

- [x] **Step 3: handoff policy 统一输出**

统一决定：

- 谁可联系谁
- 何时应该 mailbox handoff
- 何时不应直接 `sessions_send`

### 10.1 合理性判断

这一步也很合理，因为当前 mailbox/handoff 链路已经跨了 6 个文件，继续叠 Team Runtime 只会更乱。

---

## 11. Task 4: 提取 Workflow Execution Kernel

**目标：** 统一 runtime queue/session、background pool、dispatch plan、delivery adapter。

**Files:**

- Create: `tools/workflow-execution/runtime-store.ts`
- Create: `tools/workflow-execution/dispatch-plan.ts`
- Create: `tools/workflow-execution/delivery-adapter.ts`
- Create: `tools/workflow-execution/background-pool.ts`
- Create: `tools/workflow-execution/transition-orchestrator.ts`
- Modify: `tools/workflow-runtime-state.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/workflow-background-pool.ts`
- Modify: `tools/agent-task-dispatch.ts`
- Modify: `tools/lobster-handoff.ts`
- Modify: `tools/register-workflow-service.ts`

- [x] **Step 1: 消除 duplicated queue/session payload types**

统一：

- queue entry
- dispatch payload
- session lease payload

- [x] **Step 2: 让 fast-paths 只保留 request builder，不再自带一套 execution store 语义**

当前 `workflow-fast-paths.ts` 同时做了：

- command builder
- queue store
- session lease
- recovery glue

这必须拆开。

- [x] **Step 3: delivery adapter 统一 native / lobster / spawn fallback**

让 `agent-task-dispatch.ts` 与 `lobster-handoff.ts` 不再各自承载过多 orchestration 判断。

### 11.1 合理性判断

这是这次重构的关键收益点之一。因为今天如果不先统一 execution kernel，后面的 Team Runtime 根本没有一个稳定的执行底盘可挂。

---

## 12. Task 5: 提取 Workflow Projection Kernel

**目标：** 让 snapshot、status 文本、dashboard 都读同一套投影，而不是各自拼装。

**Files:**

- Create: `tools/workflow-projection/snapshot.ts`
- Create: `tools/workflow-projection/status-text.ts`
- Create: `tools/workflow-projection/dashboard-summary.ts`
- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-commands/formatters.ts`
- Modify: dashboard read-models

- [x] **Step 1: snapshot 从 domain kernel 读取，而不是自己重做 validation**

- [x] **Step 2: status formatter 从 projection kernel 读取，而不是重推导状态**

- [x] **Step 3: dashboard read-model 改成消费 projection，而不是直接拼 manifest + incidental files**

### 12.1 合理性判断

这一步很重要，因为 Team Runtime 一旦引入 task graph，如果 dashboard 还沿用现在的“直接读 manifest/raw files 拼 summary”模式，可观察性会立刻掉队。

---

## 13. Task 6: 引入 Top-Tier Evidence Contracts

**目标：** 把当前只以 skill / review 提醒 / prompt guidance 形式存在的高标准证据要求，升级成 workflow-owned contracts，并把它们接进 stage closeout、review、writing 与 top-tier bet gating。

**Files:**

- Create: `tools/workflow-evidence/papernexus-bridge.ts`
- Create: `tools/workflow-evidence/benchmark-registry.ts`
- Create: `tools/workflow-evidence/protocol-lock.ts`
- Create: `tools/workflow-evidence/statistics.ts`
- Create: `tools/workflow-evidence/venue-competition.ts`
- Create: `tools/workflow-evidence/ablation-sufficiency.ts`
- Create: `tools/workflow-evidence/mechanism-packet.ts`
- Create: `tools/workflow-evidence/reproducibility-pack.ts`
- Create: `tools/workflow-evidence/camera-ready-pack.ts`
- Create: `tools/workflow-evidence/opportunity-model.ts`
- Modify: `templates/PROJECT_MANIFEST.json`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`
- Modify: `tools/workflow-guard-stages/writing-stage-signals.ts`
- Modify: `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- Modify: `tools/workflow-guard-writing/paper-quality-eval.ts`
- Modify: `tools/workflow-guard-writing/citation-theory-eval.ts`
- Modify: `tools/workflow-commands/formatters.ts`

- [x] **Step 1: 新增独立 evidence state contracts，而不是继续塞回旧状态块**

建议新增 manifest blocks：

- `benchmark_protocol`
- `statistical_evidence`
- `venue_competition`
- `ablation_evidence`
- `mechanism_evidence`
- `reproducibility_pack`
- `camera_ready_evidence`
- `opportunity_scorecard`

要求：

- 不重载 `research_program`
- 不重载 `experiment_review_state`
- 不让 `paper_story_state` / `paper_qc` / `figure_qc` 继续兼任证据真相源

当前进展：

- 已完成前置桥接：`papernexus-bridge.ts` 已落地，并把 workflow-owned PaperNexus packet/bundle 的检测从 `stage-preflight` 里抽离。
- 已完成基座：manifest evidence state blocks 已加入 template，snapshot 与 `/workflow-status` 已能读出这些状态。
- 已补齐：这些 contracts 已接进 closeout / review / writing gates，并补齐独立 evidence materializer modules。

- [x] **Step 2: Benchmark registry + protocol lock**

让 workflow 能 first-class 表达：

- canonical benchmark family
- official split / checksum
- official eval script / metric recipe
- allowed deviations
- leaderboard comparison policy
- protocol drift detection

PaperNexus 辅助边界：

- **辅助但不是权威**
- 可以用来：
  - 发现 benchmark family
  - 收集近邻论文的 protocol variants
  - 发现常见 leaderboard comparison assumptions
- 不可以用来：
  - 直接替代本地 protocol lock
  - 直接决定项目最终采用哪一个 split / eval recipe

- [x] **Step 3: Statistical aggregation + claim-strength gate**

materialize：

- multi-seed aggregate tables
- mean / std / CI
- effect size
- significance artifacts
- claim-strength upgrade/downgrade

并让 analyze/review/write 阶段消费这套状态，而不是只在自然语言里“提醒要看显著性”。

- [x] **Step 4: Venue-competitive positioning contract**

materialize：

- target-venue competitor slate
- nearest-paper comparison deltas
- acceptance-risk scorecard
- novelty kill-switch

把当前 novelty-aware 流水线升级成 acceptance-aware 流水线。

PaperNexus 辅助边界：

- **这里是强依赖**
- 需要 graph-backed competitor discovery、nearest-paper retrieval、prior-art delta grounding
- 若 PaperNexus 不可用，可生成草稿 scorecard，但状态必须是 `unverified_graph_context`，不能通过 top-tier novelty / venue-competition gate

- [x] **Step 5: Ablation sufficiency + mechanism-evidence loop**

materialize：

- required vs optional ablations
- objection-to-ablation mapping
- mechanism-targeted ablation templates
- mechanism packet
- ablation -> causal explanation bridge

PaperNexus 辅助边界：

- **建议强辅助**
- 可用于：
  - 抽取近邻论文的常见 reviewer objection
  - 发现常见 mechanism explanations / failure modes
  - 生成 objection -> ablation mapping 初稿
- 但最终 sufficiency 与 mechanism verdict 必须基于本地实验与 analyzer packet，不能只基于 graph prior

- [x] **Step 6: Reproducibility pack + camera-ready evidence pack**

materialize：

- environment / dependency / hardware capture
- supplementary / release artifact bundle
- result-to-table-to-figure-to-caption packet
- camera-ready section packet readiness

PaperNexus 辅助边界：

- **这里不应成为关键依赖**
- reproducibility 与 camera-ready pack 的权威来源应始终是项目本地 artifacts
- PaperNexus 最多用于 related-work / benchmark naming / citation context 辅助，不参与最终通过判定

- [x] **Step 7: Top-tier bet / opportunity kill gate**

让 ideation / plan / review 可以明确得出：

- worth_top_tier_bet
- strong_but_incremental
- workshop_grade
- not_worth_current_cycle

PaperNexus 辅助边界：

- **这里是强依赖**
- opportunity model 必须吸收：
  - crowdedness / competitor density
  - nearest-paper deltas
  - venue-facing novelty pressure
- 若 graph context 不可用，则不能给出 `worth_top_tier_bet` 正结论

### 13.1 合理性判断

这一步不是“以后再加的研究质量优化”，而是这次重构必须提前纳入的主线。因为 Team Runtime 只是把阶段内执行做得更顺；如果 evidence moat contract 仍然缺位，系统最多也只是更高效地生产“结构化但未必顶会级”的结果。

---

## 14. Task 7: 把 stage closeout 接到 evidence moat gates 上

**目标：** 让阶段关闭条件从“artifact exists + basic readiness”升级成“artifact + evidence quality + top-tier bet consistency”。

**Files:**

- Modify: `tools/workflow-kernel/closeout.ts`
- Modify: `tools/workflow-kernel/readiness.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`
- Modify: `tools/workflow-guard-stages/writing-stage-signals.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`

- [x] **Step 1: `experiment -> analyze` 接 benchmark/statistics/ablation evidence**

PaperNexus 说明：

- benchmark family / protocol context 可辅助接入
- 但统计聚合与 ablation 结果本身来自本地实验 artifacts
- 不应因为 PaperNexus 短时不可用而阻止本地统计聚合完成；应只把 graph-backed comparison/benchmark context 标为待补

- [x] **Step 2: `analyze -> review` 接 mechanism/competitor slate**

PaperNexus 说明：

- 这里必须有 graph-backed competitor slate 与 mechanism prior，才能通过 top-tier review path
- 如果缺失，应允许进入本地 review，但不能标记为 top-tier-ready

- [x] **Step 3: `review -> write` 接 venue competition / top-tier bet / reproducibility readiness**

PaperNexus 说明：

- venue competition / top-tier bet 依赖 PaperNexus
- reproducibility readiness 不依赖 PaperNexus
- 这两个 gate 必须分开，避免本地复现准备被图谱依赖绑死

- [x] **Step 4: `write -> submit` 接 camera-ready evidence pack 与 supplementary readiness**

PaperNexus 说明：

- 这里的主 gate 是本地 camera-ready / supplementary readiness
- PaperNexus 只用于最终 related-work / benchmark naming / citation context 的一致性检查，不应成为提交级主阻塞项

### 14.1 合理性判断

如果不把 closeout 接到 evidence contracts，上面的新增状态最终只会变成“更完整的元数据”，而不是 workflow 真正会用来推进/阻塞的 contracts。

当前进展：

- 已完成最小接入：
  - `worth_top_tier_bet` 时，`experiment -> analyze` 已开始消费 `benchmark_protocol` / `statistical_evidence` / `ablation_evidence`
  - `worth_top_tier_bet` 时，`analyze -> review` 已开始消费 `mechanism_evidence` / `venue_competition`
  - `worth_top_tier_bet` 时，`write/submit` 已开始消费 `venue_competition` 与 `opportunity_scorecard` 的 graph context
  - `worth_top_tier_bet` 时，`write/submit` 已开始消费 `reproducibility_pack` / `camera_ready_evidence`
- 已完成聚合输出：snapshot 与 `/workflow-status` 已能给出统一的 `evidence closeout` 状态、阶段 readiness 和 blocker 摘要。
- 已完成 Team Runtime 第一刀：snapshot 与 `/workflow-status` 已能给出 evidence-aware 的 `stage task preview`。
- 已完成持久化底座：`stage task preview` 已能落盘成最小 task graph store，并通过 snapshot/status 暴露其摘要。
- 已完成最小 ownership 语义：task graph 已支持 `claim / renew / release`，且 snapshot/status 能看到 claimed 数量。
- 已完成第一条真实消费链路：auto-stage dispatch 成功后会自动 claim 一个匹配的 task graph 任务给目标 owner session。
- 已完成第二条真实消费链路：tool 侧 auto iterator dispatch 成功后也会自动 claim 一个匹配的 task graph 任务给目标 owner session。
- 已完成 team round 摘要层：当前 stage 的 lead、active session 数与 last claimed task 已有独立持久化状态。
- 已完成 claim 回收链路：runtime session 结束/失败后，协调器会自动释放其 task claim 与 team round session。
- 已完成 dashboard 读模型接入：项目详情页已能看到 top-tier verdict 与 task graph 摘要。
- 已补齐：任务完成后的 verify/satisfy、更多 dispatch surface 的 task-graph 消费、team round lifecycle 与 heartbeat idle continuation 已落地。

---

## 15. Task 8: 在新内核上引入 Team Runtime

**目标：** 这一步才真正引入 Agent Teams 风格的阶段内推进。

**Files:**

- Create: `tools/workflow-team/team-round.ts`
- Create: `tools/workflow-team/task-graph.ts`
- Create: `tools/workflow-team/task-claim.ts`
- Create: `tools/workflow-team/task-hooks.ts`
- Create: `tools/workflow-team/stage-profiles.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/register-workflow-hooks.ts`

- [x] **Step 1: 只在试点 stage materialize stage-scoped task graph**

首批：

- `experiment`
- `analyze`
- `review`

- [x] **Step 2: claim / lease / verify / reopen**

task state 统一支持：

- claimable
- claimed
- in_progress
- verifying
- completed
- needs_repair
- blocked

- [x] **Step 3: TeammateIdle 闭环**

agent 完成一个 task 后：

- 先 verify
- 再解锁依赖
- 再 self-claim 下一个可做 task
- 没有时才 idle

### 15.1 这里为什么现在才做

因为如果没有前面的 pipeline kernel 重构和 evidence contracts，Team Runtime 会直接依附在一套职责混杂、且缺少高标准证据闭环的实现上，后果就是复杂度再次指数上升，同时也只是更高效地推进中等质量产物。

---

## 16. Task 9: Role-Aware Stage Lead 与 Session Pool

**目标：** 避免 Team Runtime 最终仍退化成 researcher 中央调度。

**Files:**

- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-execution/background-pool.ts`
- Modify: `tools/workflow-subagent-sessions.ts`
- Modify: `tools/workflow-guard-policies/role-policy.ts`

- [x] **Step 1: stage lead 一律来自 StageRegistry/owner_agent**

- [x] **Step 2: pooled session policy 从 researcher-only 变成 role-aware**

- [x] **Step 3: 保留 researcher slash fast path，但不让 researcher 再代理所有阶段的微观推进**

---

## 17. Task 10: Dashboard 补 Team Runtime 与 Evidence Runtime 可观察性

**目标：** 把 Team Runtime 和 Evidence Runtime 做成可运营系统，而不是隐形状态机。

**Files:**

- Modify: `apps/workflow-dashboard/server/read-models/project-detail.ts`
- Modify: `apps/workflow-dashboard/server/read-models/project-overview.ts`
- Modify: `apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx`
- Modify: 相关组件和测试

- [x] **Step 1: 增加 Team Round 概览**

显示：

- lead role
- active tasks
- blocked tasks
- completed tasks
- closeout pending

- [x] **Step 2: 增加 Task Board**

显示：

- task status
- claimant
- dependsOn
- verification status
- latest event

- [x] **Step 3: 增加 Evidence Moat 概览**

显示：

- benchmark protocol lock
- statistical evidence quality
- venue competition score
- ablation sufficiency
- mechanism packet status
- reproducibility pack
- camera-ready evidence pack
- top-tier bet status

- [x] **Step 4: 保持 dashboard 只读**

---

## 18. Migration Strategy

### Phase 0

- 锁回归
- 提炼重复 helper
- 不改用户可见行为

### Phase 1

- workflow fact kernel
- collaboration kernel
- execution kernel
- projection kernel

### Phase 2

- evidence contracts
- stage closeout 接 evidence gates

### Phase 3

- Team Runtime pilot 到 `experiment`

### Phase 4

- 扩到 `analyze` / `review`
- dashboard 补 task board + evidence board

### Phase 5

- 再评估是否扩到 `idea` / `graph_build`
- `write` / `survey_review` 单独设计，不自动跟随

---

## 19. Acceptance Criteria

> 2026-04-11 审计后修正：以下不是“最终全部完成”的勾选表，而是当前真实覆盖状态。

- [x] `workflow-guard.ts` 已将 onboarding / plan validation / brainstorm / reflection 等重复 helper 下沉到 kernel façade。
- [x] `workflow-guard.ts` 已完成关键重复 helper 下沉；剩余 setter/materializer/prompt/runtime glue 保留为兼容 façade。
- [x] `snapshot-builder.ts` 已改为消费共享 readiness / stage kernel。
- [x] `snapshot-builder.ts` 已接入共享 readiness/stage kernel；projection model 已新增供 dashboard/runtime summary 消费。
- [x] graph-sensitive 判断统一经由 `graph-context` / `papernexus-bridge` 输出。
- [x] mailbox / handoff / contact cooldown 已由统一 collaboration kernel 提供。
- [x] native / lobster / spawn fallback 已由统一 delivery adapter 路由。
- [x] execution queue/session/pool payload 已有统一 execution façade；`workflow-fast-paths.ts` 保留兼容入口但长 EXEC / delivery / background pool 已走 kernel surface。
- [x] dashboard、snapshot、status 已有统一 projection surface；dashboard detail 已消费 canonical summary/model。
- [x] benchmark protocol lock、statistical evidence、venue competition、ablation/mechanism evidence、reproducibility pack、camera-ready evidence、top-tier bet gate 都已成为 workflow-owned state/gate。
- [x] benchmark/statistics/venue/ablation/mechanism/repro/camera/opportunity 的独立 materializer modules 已完成。
- [x] plan 中所有需要 PaperNexus 强辅助的 contracts 都明确了 degrade 语义，graph 不可用时不会伪装成已 graph-grounded。
- [x] `experiment -> analyze -> review -> write -> submit` 的 closeout 判断已消费这些 evidence contracts，而不是只看文件存在性。
- [x] Team Runtime 启用后，试点 stage 内已支持多个 teammate 领取不同 task，并通过 claim/lease/dependsOn 维持隔离。
- [x] teammate 完成 task 后，如仍有可做工作，可通过 `complete_task -> auto-claim next` 自动继续，无需 lead 再次显式派发。
- [x] hook-level idle continuation 已接入 heartbeat；task completion 通过 `complete_task` 执行 verify/satisfy/repair/auto-claim-next。
- [x] Team Runtime feature flag 已贯穿 policy、auto-iterator、service auto-claim 与 tool task actions。
- [x] 长 EXEC 指令封控规避已通过 exec budget + file-backed exec packet 实现。
- [x] PaperNexus 失败论文 first-class 重提交/顺序 retry 接口已实现。
- [x] 现有 stage handoff path 与新的 Team Runtime state 并存，旧路径未被移除。

---

## 20. Verification Plan

### 核心测试

- `node --test tests/auto-iterator.test.mjs`
- `node --test tests/workflow-runtime-tools.test.mjs`
- `node --test tests/workflow-service.test.mjs`
- `node --test tests/workflow-fast-paths.test.mjs`
- `node --test tests/workflow-runtime-orchestrator.test.mjs`
- `node --test tests/workflow-guard-snapshot-builder.test.mjs`
- `node --test tests/lobster-handoff.test.mjs`
- `node --test tests/agent-task-dispatch.test.mjs`

### 新增测试

- `node --test tests/workflow-kernel-refactor.test.mjs`
- `node --test tests/workflow-execution-kernel.test.mjs`
- `node --test tests/workflow-collaboration-kernel.test.mjs`
- `node --test tests/workflow-evidence-kernel.test.mjs`
- `node --test tests/workflow-team-runtime.test.mjs`
- `node --test tests/workflow-task-claim.test.mjs`
- `node --test tests/workflow-team-recovery.test.mjs`

### PaperNexus 相关验证

- graph available 时：
  - competitor slate / opportunity scorecard / graph-backed mechanism prior 能正常 materialize
- graph unavailable 时：
  - `venue_competition` / `opportunity_scorecard` / graph-backed `mechanism_evidence` 会进入 `unverified_graph_context`
  - 本地统计、复现、camera-ready pack 仍可继续推进
- graph 恢复后：
  - closeout gate 能从 degraded graph state 正常恢复

### Dashboard

- `npm run dashboard:test`

### 2026-04-11 验证结果

- 已通过：
  `node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-fast-paths.test.mjs tests/workflow-runtime-orchestrator.test.mjs tests/workflow-guard-snapshot-builder.test.mjs tests/lobster-handoff.test.mjs tests/agent-task-dispatch.test.mjs tests/channel-project-bindings.test.mjs tests/workflow-hook-prompt-isolation.test.mjs tests/workflow-kernel-refactor.test.mjs tests/workflow-evidence-kernel.test.mjs tests/workflow-team-runtime.test.mjs tests/workflow-task-claim.test.mjs tests/workflow-team-recovery.test.mjs tests/workflow-collaboration-kernel.test.mjs tests/workflow-execution-kernel.test.mjs tests/workflow-exec-budget.test.mjs tests/paper-ingestion-retry.test.mjs tests/workflow-survey-route.test.mjs tests/workflow-writing-lines-e2e.test.mjs tests/survey-review-materializer.test.mjs`
- 已通过：
  `npm run dashboard:test`

---

## 21. 风险与缓解

### 风险 1：重构过大，导致阶段推进逻辑回归

缓解：

- 先抽 kernel，再改调用方
- 每个 kernel 提取都先写 adapter tests

### 风险 2：重构后只“换目录”，没有实质降复杂度

缓解：

- 明确 shrink target
- 重复 helper 必须删除旧实现
- fast-paths / service / guard 不允许继续保留平行 payload model

### 风险 3：Team Runtime 仍被 researcher 中央化

缓解：

- stage lead 来自 stage registry
- role-aware pooled session

### 风险 4：dashboard 继续读旧状态，导致新 runtime 不可见

缓解：

- projection kernel 先于 Team Runtime 落地

### 风险 5：evidence contracts 变成“只记录不驱动”的摆设

缓解：

- 必须把它们接进 closeout / review / write gate
- 不允许只 materialize 不 gating

### 风险 6：top-tier evidence 要求全量压到所有项目，导致普通项目阻塞

缓解：

- `opportunity_scorecard` 区分：
  - top-tier bet
  - strong incremental
  - workshop-grade
  - not worth current cycle
- 只有 top-tier bet 项目才启用最严格 evidence gates

---

## 22. 最终判断

基于当前代码库，这次更合理的方向不是：

- “直接把 Claude Agent Teams 机制贴到现有 pipeline 上”

而是：

- “先把现有 pipeline 重构成统一 Workflow Kernel，再把 top-tier evidence loops 做成 first-class contracts，最后把 Agent Teams 式推进机制作为 stage runtime 落在其上”

换句话说：

- **Pipeline Kernel Refactor 是先决条件**
- **Evidence Moat Contracts 是质量闭环**
- **Team Runtime 是推进能力**

这比上一个版本更激进，但也更贴合当前 `openclaw-research` 的真实结构问题。只有这样做，后面的 handoff、持续推进、并行 task、idle continuation 才不会再次落进现在这套分散职责的实现里；同时也不会只是更高效地推进“结构化但证据 moat 不够强”的研究流程。
