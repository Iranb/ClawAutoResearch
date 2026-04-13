# Workflow-Owned Handoff / Failure Recovery 代码执行计划

> **Status:** CODE EXECUTION PLAN

> **Non-negotiable:** 本计划不改变现有 workflow stage truth，不让 Team Lead 自由拆任务，不把 mailbox 重新变成核心 handoff 机制。`auto_iterator_tick`、stage registry、role policy、manifest/gate/runtime state 仍是控制面真相源。新增代码只能围绕 **durable handoff intent + delivery + ack + recovery** 增强现有 pipeline。

> **Loop-hardening update:** 本计划必须把 handoff / repair / cross-domain inspiration 的所有等待路径写成可终止状态机。任何等待都必须有 deadline、retry budget、terminal state、fallback owner、observable event；任何自动恢复都不得通过重复 tick、重复 mention、重复 repair task 或重复 stub artifact 绕过 workflow gate。

---

## 0. 当前代码边界

### 0.1 不允许破坏的既有事实源

以下事实源必须继续由现有 workflow 控制：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `GATE_STATE.json`
- `EXPERIMENT_LEDGER.json`
- `.openclaw-research/workflow-runtime-*.json`
- `.openclaw-research/workflow-task-graph.json`
- `.openclaw-research/workflow-team-round.json`
- `auto_iterator_tick` stage decision
- `STAGE_REQUIREMENTS` owner routing
- `workflow-line-routing` survey / experiment line routing

新增 handoff runtime 不得直接决定 stage progression，只能表达：

- 已经由 workflow 决定的交接意图
- 交接 delivery 的尝试与结果
- 失败后应该交给谁修复
- 哪些 agent/session 已收到、ack、claim

### 0.2 不采用的方案

- 不做 Team Lead 动态拆任务。
- 不让 mailbox 作为 primary handoff truth。
- 不让 channel mention 的自然语言成为 truth。
- 不要求 agent 共享上下文。
- 不让 agent 手动改 `current_stage` 来跳关。
- 不把 survey 项目路由到 `code / experiment / analyze`，除非未来显式 hybrid mode。

### 0.3 当前已有可复用代码

- `tools/workflow-team/task-graph.ts`
  - claim / lease / release / dependency-aware claim / status
- `tools/workflow-team/task-hooks.ts`
  - complete / verify / needs_repair / auto-claim next
- `tools/workflow-team/team-round.ts`
  - team round summary
- `tools/agent-task-dispatch.ts`
  - native session dispatch
- `tools/lobster-handoff.ts`
  - Lobster optional dispatch
- `tools/stage-broadcast.ts`
  - channel-visible broadcast
- `tools/workflow-collaboration/mailbox.ts`
  - mailbox compatibility
- `tools/workflow-runtime-state.ts`
  - durable runtime queue / sessions / events
- `tools/workflow-execution/exec-packet.ts`
  - long exec packet materialization
- `tools/paper-ingestion-failures.ts`
  - PaperNexus failed-paper retry basis

---

## 1. 新增模块与文件

### 1.1 新增 `tools/workflow-handoff/`

Create:

```text
tools/workflow-handoff/handoff-types.ts
tools/workflow-handoff/handoff-store.ts
tools/workflow-handoff/handoff-events.ts
tools/workflow-handoff/handoff-router.ts
tools/workflow-handoff/handoff-delivery.ts
tools/workflow-handoff/failure-router.ts
tools/workflow-handoff/repair-queue.ts
tools/workflow-handoff/artifact-receipts.ts
tools/workflow-handoff/agent-capabilities.ts
tools/workflow-handoff/review-rounds.ts
tools/workflow-handoff/write-scope.ts
tools/workflow-handoff/inbound-budget.ts
tools/workflow-handoff/broadcast-budget.ts
```

Also create extensionless shim files for repo import compatibility:

```text
tools/workflow-handoff/handoff-types
tools/workflow-handoff/handoff-store
tools/workflow-handoff/handoff-events
tools/workflow-handoff/handoff-router
tools/workflow-handoff/handoff-delivery
tools/workflow-handoff/failure-router
tools/workflow-handoff/repair-queue
tools/workflow-handoff/artifact-receipts
tools/workflow-handoff/agent-capabilities
tools/workflow-handoff/review-rounds
tools/workflow-handoff/write-scope
tools/workflow-handoff/inbound-budget
tools/workflow-handoff/broadcast-budget
```

Each shim:

```ts
export * from "./<file>.ts";
```

### 1.2 New durable files per project

```text
{PROJ}/.openclaw-research/workflow-handoff-intents.json
{PROJ}/.openclaw-research/workflow-handoff-events.jsonl
{PROJ}/.openclaw-research/workflow-handoff-receipts.json
{PROJ}/.openclaw-research/workflow-repair-queue.json
{PROJ}/.openclaw-research/workflow-agent-capabilities.json
{PROJ}/.openclaw-research/workflow-write-scopes.json
{PROJ}/.openclaw-research/workflow-inbound-turns.jsonl
{PROJ}/.openclaw-research/workflow-broadcast-payloads/
```

### 1.3 Existing files to modify

```text
tools/workflow-team/task-hooks.ts
tools/workflow-team/task-graph.ts
tools/workflow-team/team-round.ts
tools/workflow-guard-runtime/auto-iterator.ts
tools/register-workflow-service.ts
tools/register-workflow-tools.ts
tools/register-workflow-hooks.ts
tools/agent-task-dispatch.ts
tools/lobster-handoff.ts
tools/stage-broadcast.ts
tools/workflow-runtime-state.ts
tools/workflow-runtime-recovery.ts
tools/workflow-runtime-maintenance.ts
tools/workflow-execution/exec-packet.ts
tools/paper-ingestion-failures.ts
tools/workflow-guard-prompt-assembly.ts
apps/workflow-dashboard/server/read-models/project-detail.ts
apps/workflow-dashboard/src/lib/api.ts
apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx
```

---

## 2. 数据结构设计

### 2.1 `WorkflowHandoffIntent`

File: `tools/workflow-handoff/handoff-types.ts`

```ts
export type WorkflowHandoffReason =
  | "stage_owner_change"
  | "task_completed"
  | "dependency_unblocked"
  | "verification_failed"
  | "tool_unavailable"
  | "runtime_unavailable"
  | "exec_approval_required"
  | "paper_ingestion_failed"
  | "graph_presence_failed"
  | "code_review_required"
  | "code_review_failed"
  | "plan_review_required"
  | "plan_inconsistent"
  | "survey_review_required"
  | "survey_route_drift"
  | "paper_review_required"
  | "cross_domain_evidence_missing"
  | "capability_stale"
  | "handoff_ack_timeout"
  | "discord_inbound_timeout"
  | "inbound_budget_exceeded"
  | "broadcast_delivery_timeout"
  | "stale_claim"
  | "write_scope_conflict"
  | "manual_recovery";

export type WorkflowHandoffStatus =
  | "pending"
  | "queued"
  | "dispatching"
  | "delivered"
  | "acknowledged"
  | "claimed"
  | "completed"
  | "failed"
  | "stale_claim"
  | "expired"
  | "superseded"
  | "escalated"
  | "cancelled";

export type WorkflowHandoffDeliveryChannel =
  | "native_runtime"
  | "lobster"
  | "channel_broadcast"
  | "runtime_queue"
  | "mailbox_compat"
  | "human_escalation";

export type WorkflowHandoffDeliveryAttempt = {
  attemptId: string;
  channel: WorkflowHandoffDeliveryChannel;
  status: "pending" | "delivered" | "failed" | "skipped";
  runId: string | null;
  sessionKey: string | null;
  messageId: string | null;
  queueKey: string | null;
  error: string | null;
  attemptedAt: string;
};

export type WorkflowHandoffDeliveryPlan = {
  channels: WorkflowHandoffDeliveryChannel[];
  requireAck: boolean;
  ackDeadlineAt: string | null;
  fallbackAfterMs: number | null;
  maxAttemptsTotal: number;
  maxAttemptsByChannel: Partial<Record<WorkflowHandoffDeliveryChannel, number>>;
  staleClaimAfterMs: number | null;
};

export type WorkflowHandoffIntent = {
  schemaVersion: 1;
  intentId: string;
  idempotencyKey: string;
  projectId: string | null;
  projectRoot: string;
  workflowLine: "experiment" | "survey";
  stage: string | null;
  fromRole: string | null;
  fromSessionKey: string | null;
  toRole: string;
  toSessionKey: string | null;
  reason: WorkflowHandoffReason;
  priority: "low" | "normal" | "high" | "urgent";
  sourceTaskId: string | null;
  targetTaskId: string | null;
  artifactReceiptId: string | null;
  failureId: string | null;
  failureFingerprint: string | null;
  repairLineageId: string | null;
  status: WorkflowHandoffStatus;
  deliveryPlan: WorkflowHandoffDeliveryPlan;
  deliveryAttempts: WorkflowHandoffDeliveryAttempt[];
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};
```

### 2.2 `WorkflowArtifactReceipt`

File: `tools/workflow-handoff/artifact-receipts.ts`

```ts
export type WorkflowArtifactReceipt = {
  schemaVersion: 1;
  receiptId: string;
  taskId: string | null;
  handoffIntentId: string | null;
  producedByRole: string | null;
  producedBySessionKey: string | null;
  stage: string | null;
  summary: string;
  changedFiles: string[];
  artifactPaths: string[];
  evidencePointers: string[];
  verificationCommands: string[];
  verificationResult: "passed" | "failed" | "not_run";
  blockers: string[];
  assumptions: string[];
  nextSuggestedTaskIds: string[];
  createdAt: string;
};
```

### 2.3 `WorkflowRepairQueueItem`

File: `tools/workflow-handoff/repair-queue.ts`

```ts
export type WorkflowRepairQueueItem = {
  schemaVersion: 1;
  repairId: string;
  sourceTaskId: string | null;
  sourceIntentId: string | null;
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  failureKind: WorkflowHandoffReason;
  failureReason: string;
  verificationRule: string | null;
  failureFingerprint: string;
  repairLineageId: string;
  parentRepairId: string | null;
  repairDepth: number;
  maxRepairDepth: number;
  originalOwner: string | null;
  repairOwner: string;
  fallbackOwners: string[];
  retryBudgetRemaining: number;
  staleClaimAfterMs: number;
  nextEligibleAt: string | null;
  status: "queued" | "claimed" | "completed" | "failed" | "escalated";
  createdAt: string;
  updatedAt: string;
};
```

### 2.4 Agent capability record

File: `tools/workflow-handoff/agent-capabilities.ts`

```ts
export type WorkflowAgentCapabilityRecord = {
  schemaVersion: 1;
  sessionKey: string;
  sessionId: string | null;
  role: string | null;
  agentId: string | null;
  projectRoot: string | null;
  messageChannel: string | null;
  canUseResearchWorkflow: boolean;
  canUsePaperNexusRemote: boolean;
  canReceiveNativeDispatch: boolean;
  canRunExecPacket: boolean;
  canUseLobster: boolean;
  capabilityTtlMs: number;
  confidence: "unknown" | "low" | "medium" | "high";
  degradedReason: string | null;
  lastSeenAt: string;
  expiresAt: string;
};
```

### 2.5 Inbound turn budget record

File: `tools/workflow-handoff/inbound-budget.ts`

```ts
export type WorkflowInboundTurnRecord = {
  schemaVersion: 1;
  turnId: string;
  projectId: string | null;
  projectRoot: string;
  channelKey: string | null;
  sessionKey: string | null;
  agentId: string | null;
  action: string;
  status:
    | "started"
    | "completed_inline"
    | "deferred"
    | "timed_out"
    | "failed";
  inboundBudgetMs: number;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  deferredRunId: string | null;
  deferredQueueKey: string | null;
  idempotencyKey: string;
  summaryPath: string | null;
  error: string | null;
};
```

### 2.6 Broadcast payload budget record

File: `tools/workflow-handoff/broadcast-budget.ts`

```ts
export type WorkflowBroadcastPayloadBudget = {
  schemaVersion: 1;
  broadcastId: string;
  idempotencyKey: string;
  projectId: string | null;
  projectRoot: string;
  channelKey: string | null;
  sessionKey: string | null;
  payloadPath: string | null;
  summary: string;
  fullMessageCharCount: number;
  postedMessageCharCount: number;
  truncated: boolean;
  maxInlineChars: number;
  deliveryMode: "inline" | "payload_pointer" | "outbox_only";
  createdAt: string;
};
```

---

## 3. 代码执行步骤

### Step 1：实现 handoff store，不接业务路径

Files:

```text
tools/workflow-handoff/handoff-types.ts
tools/workflow-handoff/handoff-store.ts
tools/workflow-handoff/handoff-events.ts
tests/workflow-handoff-intent.test.mjs
```

Implementation:

- Add `getWorkflowHandoffIntentPath(projectRoot)`.
- Add `readWorkflowHandoffIntentStore(projectRoot)`.
- Add `writeWorkflowHandoffIntentStore(...)` with atomic write.
- Add `upsertWorkflowHandoffIntent(...)`.
- Add `appendWorkflowHandoffEvent(...)` JSONL.
- Add dedupe by `idempotencyKey`.
- Add status transition guard:
  - `pending -> queued -> dispatching -> delivered -> acknowledged -> claimed -> completed`
  - `pending -> dispatching` is allowed when the first delivery attempt starts immediately.
  - `delivered -> acknowledged` is required when `deliveryPlan.requireAck=true`.
  - `acknowledged -> claimed` is required for task-bearing intents; stage-owner notice intents may complete after ack.
  - `claimed -> failed` is allowed only with failure evidence and optional repair queue creation.
  - `claimed -> stale_claim` must happen when no progress event is recorded before `staleClaimAfterMs`.
  - `pending/queued/dispatching/delivered/acknowledged -> expired` when `expiresAt` passes.
  - `failed/expired/stale_claim -> escalated` when retry budget or fallback owners are exhausted.
  - `any non-terminal -> superseded` only when a newer intent with same idempotency key carries a higher manifest version or stage decision revision.
  - `any non-terminal -> cancelled` only through explicit workflow maintenance / user cancellation event.
  - Terminal statuses are `completed`, `expired`, `superseded`, `escalated`, and `cancelled`.
- Do not modify auto_iterator yet.

Tests:

- Create same intent twice returns same intent.
- Status transition writes event.
- Invalid transition is rejected or no-op with reason.
- Store survives reread.

### Step 2：artifact receipt store

Files:

```text
tools/workflow-handoff/artifact-receipts.ts
tests/workflow-artifact-receipts.test.mjs
```

Implementation:

- Add receipt store path.
- Add `createWorkflowArtifactReceipt(...)`.
- Normalize arrays and dedupe paths.
- Add receipt lookup by task id.
- Keep compatibility: if `complete_task` has only `completionNote`, generate minimal receipt with `verificationResult="not_run"`.

Tests:

- Receipt persists changed files/artifact paths.
- Duplicate receipt id does not duplicate.
- Minimal receipt works.

### Step 3：wire receipts into `complete_task`

Files:

```text
tools/register-workflow-tools.ts
tools/workflow-team/task-hooks.ts
tests/workflow-runtime-tools.test.mjs
```

Implementation:

- Add `artifactReceipt` param to tool schema.
- In `complete_task`, before `completeWorkflowTaskAndContinue`, create receipt.
- Pass receipt id into completion/handoff context.
- Preserve current `completionNote` behavior.

Tests:

- `complete_task` with receipt stores receipt.
- `complete_task` without receipt remains backward compatible.

### Step 4：handoff router for task completion and dependency unlock

Files:

```text
tools/workflow-handoff/handoff-router.ts
tools/workflow-team/task-hooks.ts
tests/workflow-handoff-router.test.mjs
```

Implementation:

- Add `buildTaskCompletionHandoffIntents(...)`.
- On task completed:
  - find tasks that were dependency-blocked and are now claimable.
  - create one intent per downstream owner/task.
  - create one audit intent for current stage owner if needed.
- Do not dispatch yet; only persist intents.
- Ensure idempotency by `projectId:stage:sourceTaskId:targetTaskId:reason`.

Tests:

- Completing upstream task creates downstream handoff intent.
- Re-running completion does not duplicate intent.
- Survey task completion never routes to coder unless task owner is coder and workflow line is hybrid.

### Step 5：handoff router for stage owner change

Files:

```text
tools/workflow-guard-runtime/auto-iterator.ts
tools/workflow-handoff/handoff-router.ts
tests/workflow-handoff-router.test.mjs
```

Implementation:

- After `stageAfter/ownerAfter` is computed and before/after manifest save, detect owner change or stage change.
- Create `stage_owner_change` intent.
- Intent should include:
  - from role
  - to role
  - stageAfter
  - nextAction
  - missingStageSignals
  - blockingReason if any
- Do not let intent alter stage truth.

Tests:

- `plan -> code` creates intent to coder.
- `survey_review -> write` creates intent to academic_writer.
- `frontier_mapping -> survey_review` does not create idea handoff.

### Step 6：delivery ladder

Files:

```text
tools/workflow-handoff/handoff-delivery.ts
tools/agent-task-dispatch.ts
tools/lobster-handoff.ts
tools/stage-broadcast.ts
tools/workflow-handoff-runtime.ts
tests/workflow-handoff-delivery.test.mjs
```

Implementation:

- Add `deliverWorkflowHandoffIntent(...)`.
- Delivery order:
  1. native runtime dispatch if target session known/capable
  2. Lobster if explicitly enabled and not in dry-run-only mode
  3. channel broadcast mention
  4. runtime queue
  5. mailbox compatibility note
  6. human escalation event
- Each attempt appends to intent deliveryAttempts.
- Delivery must read `deliveryPlan.maxAttemptsTotal` and `deliveryPlan.maxAttemptsByChannel` before every attempt.
- If total attempts are exhausted, set status `escalated` and append a human escalation event instead of attempting another channel.
- If a channel has a deterministic failure, mark that channel exhausted for this intent and do not retry it.
- If channel broadcast succeeds but no ack arrives before `ackDeadlineAt`, set reason `handoff_ack_timeout` and perform runtime queue fallback once.
- If runtime queue fallback also fails or remains unclaimed until `expiresAt`, set status `escalated`.
- Lobster default policy:
  - `disabled` for all projects until `tests/workflow-lobster-delivery-e2e.test.mjs` passes in the local repo.
  - `dry_run` can record intended Lobster payloads but must not count as successful delivery.
  - `enabled` requires project-level feature flag plus successful capability check.
- Stop deterministic failures:
  - target role invalid
  - project missing
  - policy disabled
- Continue fallback on transient failures:
  - runtime unavailable
  - timeout
  - Lobster error
- Channel mention must include intent id.

Tests:

- Native success stops ladder.
- Native failure falls back to channel broadcast.
- Lobster disabled skips Lobster.
- Lobster dry-run records attempt but does not mark intent delivered.
- Mailbox note is written only as compatibility attempt.
- Unacked channel mention falls back to runtime queue once and then escalates if still unclaimed.
- Exhausted total attempts transitions to `escalated` without creating a duplicate intent.
- Intent records all attempts.

### Step 7：ack / claim protocol

Files:

```text
tools/register-workflow-tools.ts
tools/workflow-handoff/handoff-store.ts
tools/workflow-team/task-graph.ts
tests/workflow-handoff-ack.test.mjs
```

Implementation:

- Add tool actions:
  - `get_handoff_intents`
  - `ack_handoff_intent`
  - `claim_handoff_intent`
  - `fail_handoff_intent`
- `claim_handoff_intent` should:
  - mark intent `claimed`
  - claim target task if targetTaskId present
  - record session key
  - write `claimedAt`, `claimLeaseExpiresAt`, and the claiming capability snapshot
- Claimed intents must produce one of the following before `staleClaimAfterMs`:
  - artifact receipt
  - task progress event
  - explicit blocker event
  - fail intent event
- If no progress signal appears before `claimLeaseExpiresAt`, runtime maintenance marks the intent `stale_claim` and routes repair/fallback according to failure policy.
- Stage owner handoff may be acked without task claim.

Tests:

- Target owner can ack intent.
- Wrong owner cannot claim unless researcher/admin role.
- Claiming task intent claims task graph entry.
- Claimed intent without progress becomes stale and routes to fallback owner once.

### Step 8：failure router and repair queue

Files:

```text
tools/workflow-handoff/failure-router.ts
tools/workflow-handoff/repair-queue.ts
tools/workflow-team/task-hooks.ts
tests/workflow-failure-recovery.test.mjs
```

Implementation:

- Define failure routing table.
- Every failure record must include:
  - `failureFingerprint = hash(projectRoot, workflowLine, stage, failureKind, verificationRule, normalizedFailureReason, sourceTaskId)`
  - `repairLineageId = source task id or parent repair lineage id`
  - `repairDepth`
  - `maxRepairDepth`
- In `completeWorkflowTaskAndContinue`, when verification fails:
  - create failure record
  - create repair queue item
  - create handoff intent to repair owner
  - optionally keep original task claimed until repair owner claims repair task
- Do not create a second active repair queue item with the same `failureFingerprint`.
- Do not create a child repair item when `repairDepth >= maxRepairDepth`; escalate to human instead.
- Repair task completion must either:
  - close the matching repair item
  - decrement retry budget and requeue with the same `repairLineageId`
  - escalate when the budget is exhausted
- Retry budget defaults:
  - verification_failed: 2
  - code_review_failed: 2
  - plan_inconsistent: 2
  - paper_ingestion_failed: 3
  - cross_domain_evidence_missing: 2 search/requisition rounds, then waiver or escalation
  - capability_stale: 1 reassignment attempt, then human escalation
  - handoff_ack_timeout: 1 runtime queue fallback, then human escalation
  - stale_claim: 1 fallback owner reassignment, then human escalation
  - write_scope_conflict: no retry until conflicting lease expires or explicit override event exists
  - exec_approval_required: 1 then human escalation
- Exhausted retry budget -> urgent human escalation intent.

Tests:

- Failed verification creates repair queue item.
- Repair owner deterministic by failure kind.
- Retry budget decrements.
- Exhausted repair escalates.
- Same `failureFingerprint` does not create duplicate active repairs.
- Repair-of-repair is capped by `maxRepairDepth`.

### Step 9：agent capability registry

Files:

```text
tools/workflow-handoff/agent-capabilities.ts
tools/workflow-runtime-state.ts
tools/register-workflow-hooks.ts
tools/register-workflow-tools.ts
tests/workflow-agent-capabilities.test.mjs
```

Implementation:

- Add capability store under `.openclaw-research`.
- On `before_prompt_build`, record current agent/session capability best-effort:
  - role
  - sessionKey
  - canUseResearchWorkflow true for workflow tool surface
  - message channel
- Capability records expire after `capabilityTtlMs`.
- Default `capabilityTtlMs`:
  - foreground workflow tool session: 10 minutes
  - native runtime dispatch session: 5 minutes
  - channel-only agent identity: 2 minutes
  - Lobster capability: 2 minutes unless Lobster e2e heartbeat exists
- On tool execution, refresh `canUseResearchWorkflow=true`.
- On tool-unavailable error, immediately downgrade the matching capability:
  - set `confidence="low"`
  - set `degradedReason`
  - set `expiresAt=now`
  - append capability degradation event
- Handoff delivery should select capable session for workflow actions.
- If target foreground lacks tool, route to capable same-role session or researcher fallback.
- If no non-expired capable session exists, create `tool_unavailable` or `capability_stale` repair intent instead of asking the wrong agent to run an impossible workflow action.

Tests:

- Capability heartbeat persists.
- Tool action updates capability.
- Handoff for `queue_paper_ingestion_retry` avoids session without research_workflow.
- Stale capability is ignored during delivery selection.
- Tool-unavailable error downgrades capability and triggers reassignment/escalation.

### Step 10：channel mention delivery with ack timeout

Files:

```text
tools/stage-broadcast.ts
tools/workflow-handoff/handoff-delivery.ts
tools/register-workflow-tools.ts
tests/workflow-channel-mention-delivery.test.mjs
```

Implementation:

- Broadcast text includes:
  - handoff intent id
  - target role
  - project id/root
  - stage
  - ack command
- Add ack timeout field to intent.
- Runtime maintenance checks delivered-but-unacked intents past deadline.
- If unacked, queue fallback dispatch.

Tests:

- Mention includes intent id.
- Unacked mention becomes fallback queue.
- Acked mention does not retry.

### Step 11：review/code-review collaboration as handoff rounds

Files:

```text
tools/workflow-handoff/review-rounds.ts
tools/workflow-auto-gate.ts
tools/workflow-code-review.ts
tools/workflow-auto-discussion.ts
tests/workflow-review-round-handoff.test.mjs
```

Implementation:

- Wrap review request in handoff intent.
- Each reviewer result creates artifact receipt.
- Aggregate pass creates next-stage handoff.
- Aggregate revise/block creates repair handoff.
- Code review failure -> coder repair.
- Plan inconsistency -> orchestrator repair.

Tests:

- Code review failure creates coder repair intent.
- Plan review failure creates orchestrator repair intent.
- Pass creates next owner handoff.

### Step 12：write-scope safety

Files:

```text
tools/workflow-handoff/write-scope.ts
tools/workflow-team/stage-profiles.ts
tools/workflow-team/task-graph.ts
tests/workflow-write-scope.test.mjs
```

Implementation:

- Add optional task fields:
  - `writeScope.ownedDirs`
  - `writeScope.exclusiveFiles`
  - `writeScope.mode = read_only | append_only | exclusive_write`
  - `writeScope.leaseTtlMs`
  - `writeScope.claimedAt`
  - `writeScope.leaseExpiresAt`
- Before claim, detect active conflicting claims.
- Always exclusive:
  - `PROJECT_MANIFEST.json`
  - `TRACK_REGISTRY.json`
  - `.openclaw-research/workflow-task-graph.json`
  - `.openclaw-research/workflow-handoff-intents.json`
- Allow read-only parallel claims.
- Default write-scope lease:
  - manifest / registry / task graph / handoff store: 5 minutes
  - project artifacts under one agent-owned directory: 30 minutes
  - long-running analyzer/coder output directories: 2 hours with heartbeat extension
- A stale exclusive lease may be released only by runtime maintenance after appending `write_scope_stale_released` event.
- If conflicting lease is active and non-stale, create `write_scope_conflict` blocker event instead of busy retry.

Tests:

- Conflicting exclusive task claim is blocked.
- Read-only task claim is allowed.
- Lead/researcher override requires explicit flag and event.
- Stale write-scope lease can be released by maintenance and reassigned once.

### Step 13：PaperNexus retry completion integration

Files:

```text
tools/paper-ingestion-failures.ts
tools/register-workflow-tools.ts
tools/graph-presence.ts
tools/workflow-handoff/failure-router.ts
tests/paper-ingestion-retry.test.mjs
```

Implementation:

- Before retry manifest:
  - read latest `GRAPH_PRESENCE_CHECK.json`
  - optionally run `check_graph_presence` fresh if stale
  - match failures against present papers by arXiv/DOI/sourceKey/title signature
- During retry:
  - set `retry_status=running` when background run starts
  - persist `retry_run_id`
- After retry terminal:
  - refresh graph presence
  - move successful items to completed
  - remaining retry failures -> repair handoff intent

Tests:

- Already-in-graph failure skipped.
- Retry completion refreshes graph presence.
- Remaining failures create repair intent.

### Step 14：exec packet runner

Files:

```text
tools/workflow-execution/exec-packet.ts
tools/register-workflow-tools.ts
tools/workflow-handoff/failure-router.ts
tests/workflow-exec-budget.test.mjs
```

Implementation:

- Add tool action `run_exec_packet`.
- Validate path under `.openclaw-research/exec-packets`.
- Verify sha256.
- Execute through approved local/runtime surface only.
- Record `{packetId}.result.json`.
- On OpenClaw approval error, create `exec_approval_required` handoff intent.

Tests:

- Long command materializes packet.
- `run_exec_packet` verifies sha.
- Execution result is persisted.
- Approval error creates recovery handoff.

### Step 15：dashboard handoff/recovery view

Files:

```text
apps/workflow-dashboard/server/read-models/project-detail.ts
apps/workflow-dashboard/src/lib/api.ts
apps/workflow-dashboard/src/pages/ProjectDetailPage.tsx
```

Implementation:

- Add read model fields:
  - pendingHandoffCount
  - failedHandoffCount
  - unackedHandoffCount
  - repairQueueCount
  - staleClaimCount
  - capabilityWarnings
- UI sections:
  - Handoff intents
  - Delivery attempts
  - Repair queue
  - Capability mismatch
- Keep dashboard read-only.

Tests:

- Dashboard renders pending/failed handoffs.
- Dashboard renders repair queue.
- Dashboard remains read-only.

### Step 16：Discord inbound worker budget and deferred execution

Problem evidence:

- `Discord inbound worker timed out` is a transport/inbound-worker timeout, not proof that workflow state work failed.
- Current `auto_iterator_tick` path can synchronously run stage reconciliation, task dispatch, stage broadcast, and status broadcast in one inbound tool call.
- Current stage broadcast path records an outbox event, but a duplicate outbox entry does not automatically short-circuit `runtimeSubagent.run`.
- Repeated user pings or repeated agent recovery turns can therefore trigger duplicate nested broadcasts and long synchronous work inside the Discord inbound worker.

Files:

```text
tools/workflow-handoff/inbound-budget.ts
tools/workflow-handoff/broadcast-budget.ts
tools/register-workflow-tools.ts
tools/stage-broadcast.ts
tools/workflow-runtime-maintenance.ts
tools/workflow-session-orchestrator.ts
tools/workflow-guard-prompt-assembly.ts
tests/workflow-inbound-budget.test.mjs
tests/workflow-broadcast-budget.test.mjs
```

Implementation:

- Add `withWorkflowInboundBudget(...)`.
- Default inbound budgets:
  - Discord/chat inbound tool call: 8 seconds total synchronous work.
  - `auto_iterator_tick` inside Discord/chat: 5 seconds inline, then defer remaining dispatch/broadcast.
  - stage/status broadcast launch: 1.5 seconds inline, then outbox-only.
  - mailbox ack wait during Discord/chat dispatch: 500 ms inline max.
- `auto_iterator_tick` must support:
  - `iterator.executionMode = "inline" | "defer_after_budget" | "outbox_only"`
  - default `defer_after_budget` for Discord/chat sessions.
- If budget is exceeded:
  - persist `WorkflowInboundTurnRecord(status="deferred")`
  - enqueue remaining dispatch/broadcast into runtime queue/outbox
  - return a compact response with `deferred=true`, `queueKey`, and current live snapshot summary
  - do not run another `auto_iterator_tick` from the same inbound turn
- Stage/status broadcast must become outbox-first:
  - call `recordWorkflowBroadcastEvent(...)`
  - if it returns `created=false` and existing entry is `pending` or `delivered`, skip `runtimeSubagent.run`
  - if inline budget is exhausted, leave deliveryStatus `pending` and let runtime maintenance deliver it
  - never call `runtimeSubagent.run` twice for the same idempotency key in the same inbound turn
- Broadcast message budget:
  - max inline broadcast text: 1500 chars
  - max `[ARTIFACTS]` or `Recommended action` inline fragment: 400 chars
  - if full message exceeds budget, write full details to `workflow-broadcast-payloads/<broadcastId>.md`
  - posted message must include only summary plus payload path
- Prompt guard update:
  - Agents must treat `Discord inbound worker timed out` as transport timeout.
  - Do not retry the whole stage from chat.
  - First inspect live workflow snapshot / latest inbound turn record.
  - If a deferred queue/outbox entry exists, report it and wait for runtime maintenance or run a bounded maintenance pass.
- If Discord inbound timeout is observed:
  - create `discord_inbound_timeout` runtime incident
  - mark related inbound turn `timed_out` if known
  - do not mutate stage truth
  - do not create duplicate stage handoff intent unless idempotency key changes

Tests:

- `auto_iterator_tick` in Discord/chat defers dispatch/broadcast after budget instead of timing out.
- Duplicate stage broadcast idempotency key records one outbox entry and calls `runtimeSubagent.run` at most once.
- Oversized broadcast payload is materialized and compacted before posting.
- Repeated user pings coalesce to one active inbound turn per project/channel/action.
- `Discord inbound worker timed out` incident does not regress or advance workflow stage by itself.
- Deferred queue/outbox delivery can be replayed by runtime maintenance.

---

## 4. Termination and anti-loop rules

### 4.1 Intent retry loop prevention

Every handoff intent must have:

- `idempotencyKey`
- `createdAt`
- `expiresAt`
- max delivery attempts per channel
- max total attempts
- terminal state

Rules:

- Do not create a new intent if an active intent with same idempotency key exists.
- Do not retry a deterministic failure channel.
- Do not retry after `expiresAt`; create escalation instead.
- Do not create a repair intent from the same failure more than once per retry budget tick.

### 4.2 Task repair loop prevention

Every repair queue item must have:

- `retryBudgetRemaining`
- `failureKind`
- `sourceTaskId`
- `repairOwner`
- `status`

Rules:

- When retry budget reaches 0, status becomes `escalated`.
- Escalated repair blocks stage closeout.
- Same owner can retry only while budget remains.
- Reassignment must be recorded as event.

### 4.3 Stage loop prevention

Rules:

- Handoff intent must not mutate `current_stage`.
- Stage mutation remains only in auto iterator / approved workflow tools.
- Survey route recovery must never create code/experiment handoff.
- `manual_recovery` intent can request recovery but cannot directly skip stage validation.

### 4.4 Delivery loop prevention

Rules:

- Mention delivery without ack after deadline becomes runtime queue fallback once.
- Runtime queue failure after max attempts becomes human escalation.
- Mailbox compatibility note never triggers another mailbox handoff by itself.

### 4.5 Handoff intent state machine

Every implementation path must use the same state machine. No module may invent a parallel lifecycle.

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `pending` | Intent exists, no delivery attempt started. | `queued`, `dispatching`, `expired`, `superseded`, `cancelled` |
| `queued` | Intent is waiting for runtime maintenance / delivery worker. | `dispatching`, `expired`, `superseded`, `cancelled` |
| `dispatching` | A delivery attempt is currently being made. | `delivered`, `failed`, `queued`, `expired`, `escalated` |
| `delivered` | At least one delivery channel reached the target surface. | `acknowledged`, `failed`, `expired`, `escalated` |
| `acknowledged` | Target role/session acknowledged the intent. | `claimed`, `completed`, `failed`, `expired`, `escalated` |
| `claimed` | Target role/session accepted responsibility. | `completed`, `failed`, `stale_claim`, `expired`, `escalated` |
| `failed` | Execution failed with evidence and can still be repaired. | `queued`, `escalated`, `superseded` |
| `stale_claim` | Claim lease expired without progress evidence. | `queued`, `escalated`, `superseded` |
| `completed` | Target completed or intentionally accepted the handoff. | terminal |
| `expired` | Intent exceeded `expiresAt`. | terminal |
| `superseded` | A newer workflow decision replaces this intent. | terminal |
| `escalated` | Automatic recovery budget is exhausted. | terminal |
| `cancelled` | User/workflow maintenance explicitly cancelled it. | terminal |

State machine invariants:

- `completed`, `expired`, `superseded`, `escalated`, and `cancelled` are terminal.
- Terminal intents must never be delivered, claimed, repaired, or retried.
- A repeated `auto_iterator_tick` may update read-model fields but must not create a second active intent with the same idempotency key.
- Stage progression must never be inferred from `completed` handoff status; only workflow stage truth can advance the stage.

### 4.6 Default budgets and terminal policies

All budget defaults must live in one module, for example `tools/workflow-handoff/handoff-defaults.ts`. Tests must assert these defaults directly.

| Intent / failure kind | `ackDeadlineMs` | `expiresInMs` | `maxAttemptsTotal` | Repair budget | Terminal path |
| --- | ---: | ---: | ---: | ---: | --- |
| `stage_owner_change` | 10 min | 60 min | 4 | 1 fallback owner | runtime queue once, then human escalation |
| `task_completed` | 10 min | 60 min | 4 | 1 fallback owner | runtime queue once, then human escalation |
| `dependency_unblocked` | 10 min | 60 min | 4 | 1 fallback owner | runtime queue once, then human escalation |
| `verification_failed` | 15 min | 6 h | 4 | 2 | repair owner, then human escalation |
| `code_review_failed` | 30 min | 12 h | 4 | 2 | coder repair, then human escalation |
| `plan_inconsistent` | 30 min | 12 h | 4 | 2 | orchestrator repair, then human escalation |
| `paper_ingestion_failed` | 30 min | 24 h | 4 | 3 | researcher retry, then graph-ready waiver or escalation |
| `cross_domain_evidence_missing` | 30 min | 24 h | 4 | 2 requisition rounds | researcher requisition, waiver, or escalation |
| `tool_unavailable` | 10 min | 2 h | 3 | 1 reassignment | capable same-role session, researcher fallback, then escalation |
| `capability_stale` | 10 min | 2 h | 3 | 1 reassignment | capability refresh, reassignment, then escalation |
| `handoff_ack_timeout` | none | inherited | 1 fallback | 0 | runtime queue once, then escalation |
| `discord_inbound_timeout` | none | inherited | 0 inline | 0 | record incident, defer remaining work, no stage mutation |
| `inbound_budget_exceeded` | none | inherited | 0 inline | 0 | queue/outbox remaining work and return compact response |
| `broadcast_delivery_timeout` | none | inherited | 1 outbox delivery | 0 | leave pending for maintenance, then warning incident |
| `stale_claim` | none | inherited | 1 fallback | 1 fallback owner | release lease, reassign once, then escalation |
| `write_scope_conflict` | none | 2 h | 0 | 0 until lease expires | wait for lease expiry or explicit override |
| `exec_approval_required` | none | 24 h | 1 | 1 | materialize exec packet, then human approval escalation |

Default channel attempt caps:

- `native_runtime`: 1 per intent unless capability refresh changes the selected session.
- `lobster`: 1 dry-run or 1 enabled attempt, never both for the same intent.
- `channel_broadcast`: 1 mention per intent.
- `runtime_queue`: 1 fallback enqueue per intent.
- `mailbox_compat`: 1 compatibility note per intent.
- `human_escalation`: 1 terminal event per intent.

### 4.7 Idempotency and duplicate prevention

Every generated intent must use a deterministic idempotency key. The key must be stable across repeated ticks but change when the underlying workflow decision changes.

Recommended key shapes:

```text
stage_owner_change:{projectId}:{workflowLine}:{stageAfter}:{ownerAfter}:{manifestRevision}:{routeRevision}
task_completed:{projectId}:{sourceTaskId}:{targetTaskId}:{artifactReceiptId}
dependency_unblocked:{projectId}:{sourceTaskId}:{targetTaskId}:{dependencyRevision}
verification_failed:{projectId}:{sourceTaskId}:{failureFingerprint}
paper_ingestion_failed:{projectId}:{paperFailureBatchId}:{failureFingerprint}
cross_domain_evidence_missing:{projectId}:{targetProblemHash}:{missingDomainsHash}:{requisitionRound}
tool_unavailable:{projectId}:{toRole}:{requiredTool}:{capabilityRevision}
stale_claim:{projectId}:{intentId}:{claimLeaseRevision}
write_scope_conflict:{projectId}:{conflictingTaskId}:{requestedScopeHash}:{activeLeaseId}
discord_inbound_timeout:{projectId}:{channelKey}:{action}:{turnId}
inbound_budget_exceeded:{projectId}:{channelKey}:{action}:{budgetWindow}
broadcast_delivery_timeout:{projectId}:{broadcastId}:{idempotencyKey}
```

Duplicate prevention rules:

- `upsertWorkflowHandoffIntent` must return the existing active intent when the same idempotency key exists.
- If the existing intent is terminal, a new intent may be created only when the key changes or an explicit `manual_recovery` event references the terminal intent.
- A repair queue item with the same active `failureFingerprint` blocks creation of another repair item.
- A mailbox compatibility note must not be used as a source event for creating another handoff intent.
- Duplicate inbound turns for the same `{projectId, channelKey, action}` inside the active budget window must coalesce to the existing turn record.
- Duplicate broadcast outbox records must short-circuit inline delivery instead of launching another nested runtime run.

### 4.8 Repair lineage and repair-of-repair prevention

Repair tasks must not recursively generate unbounded repair tasks.

Rules:

- `repairLineageId` is inherited by every child repair item created from the same original failure.
- `failureFingerprint` dedupes active repair items inside the same lineage.
- `repairDepth` starts at `0` for the first repair.
- `maxRepairDepth` defaults to `2`.
- If a repair task fails because the same verification rule still fails, decrement retry budget and reuse the same repair item instead of creating a child repair.
- If a repair task fails for a different failure kind, create a child repair only when `repairDepth < maxRepairDepth`.
- If `repairDepth >= maxRepairDepth`, create `human_escalation` and block stage closeout with an observable escalated repair item.

### 4.9 Capability staleness and downgrade rules

Capability records are advisory, not permanent truth.

Rules:

- Delivery selection must ignore capability records with `expiresAt < now`.
- Tool execution failure saying a tool is unavailable immediately downgrades the current session capability.
- A downgraded capability cannot be used for delivery until a later successful tool heartbeat refreshes it.
- If all target-role capabilities are stale, route to same-role fallback only once.
- If fallback also lacks capability, create `tool_unavailable` repair intent to researcher/orchestrator rather than asking the same incapable agent again.

### 4.10 Write-scope deadlock prevention

Write-scope safety must protect shared files without creating permanent locks.

Rules:

- Every exclusive write claim must have `leaseExpiresAt`.
- Runtime maintenance may release a stale lease only after writing `write_scope_stale_released`.
- Active non-stale conflicts produce `write_scope_conflict` and no busy retry.
- Manual override requires an explicit event with requester role, reason, previous owner, and affected paths.
- Stage truth files are never force-overridden by ordinary agent handoff.

### 4.11 Cross-domain non-blocking policy

Cross-domain inspiration should improve idea/story quality without creating infinite research loops.

Rules:

- `cross_domain_inspiration.max_requisition_rounds` defaults to `2`.
- Each requisition round must increment `requisition_round`.
- Missing preferred-domain evidence after the final round must choose one of:
  - `waived` with explicit rationale and `waived_by`
  - `blocked` with human escalation
  - `partial` story usage that forbids strong headline claims
- PaperNexus unavailable creates a repair intent once; repeated unavailability after budget exhaustion creates evidence debt and escalation.
- Survey projects may continue with evidence debt if cross-domain content is only used for taxonomy/future-directions enrichment.
- Experiment projects cannot use cross-domain framing as a headline contribution unless `status in [recontextualized, story_ready]`.

### 4.12 Lobster safety policy

Lobster must remain optional until proven in this workflow.

Rules:

- Default Lobster mode is `disabled`.
- `dry_run` records payload shape and route decision but cannot mark an intent delivered.
- `enabled` requires:
  - project feature flag
  - non-expired `canUseLobster=true` capability
  - passing Lobster e2e test
  - rollback path to channel broadcast/runtime queue
- Lobster failure must be treated as a delivery failure, not an agent execution failure.
- Lobster failure must not create a repair task unless all other delivery paths also fail.

### 4.13 Discord inbound timeout prevention

Discord/chat inbound workers are latency-sensitive. Workflow correctness must not depend on completing long workflow work before the inbound worker deadline.

Rules:

- Inbound tool calls must be treated as request/ack surfaces, not long-running workflow workers.
- A single inbound turn may run at most one `auto_iterator_tick`.
- `auto_iterator_tick` may reconcile stage truth inline, but dispatch and broadcast must be deferred when budget is close to exhaustion.
- Nested `runtimeSubagent.run` calls from an inbound turn must be best-effort and budgeted.
- Duplicate broadcast idempotency keys must skip nested delivery immediately.
- Long recommended actions, blocker lists, participant summaries, or command text must be materialized to payload files instead of posted inline.
- When `Discord inbound worker timed out` appears, agents must not infer workflow failure or retry the whole stage. They must inspect live state and pending outbox/queue records.
- A timeout incident must never advance or regress `current_stage`.
- If a timeout happens after state mutation but before broadcast, runtime maintenance must replay only the missing broadcast/outbox delivery, not rerun the stage transition.

### 4.14 Broadcast storm prevention

Repeated stage updates are harmful even when each individual update is correct.

Rules:

- One stage transition revision may create one stage broadcast idempotency key.
- Replaying an existing broadcast may update delivery metadata, but must not create another nested agent turn.
- If live state has already moved past a broadcast's `stageAfter`, mark the old broadcast `superseded` instead of posting it.
- If a regression and an advancement are both detected inside one budget window, post only the latest live snapshot summary and write both transitions to diagnostics.
- Broadcast content must prefer stable artifact paths over full blocker/action dumps.

---

## 5. Quality constraints for experiment pipeline

Experiment pipeline handoff/recovery must continue enforcing previous quality gates:

- graph context readiness before novelty-sensitive stages
- benchmark protocol lock
- statistical evidence / claim strength
- ablation sufficiency
- mechanism evidence
- venue competition
- reproducibility pack
- camera-ready evidence
- code review gate
- final submit gate

Handoff cannot bypass these gates.

If an agent is blocked by one of these gates:

- create failure/repair intent with deterministic owner
- keep stage truth unchanged
- attach evidence blocker list
- do not invent stub artifacts to pass gates

---

## 6. Quality constraints for survey pipeline

Survey pipeline handoff/recovery must enforce:

- `workflow_line=survey`
- `paper_type=survey`
- `writing_contract.paper_mode=survey`
- `survey_review.topic`
- survey retrieval/query registry
- included/excluded paper sets
- coverage summary
- SOTA matrix
- gap synthesis
- survey brief
- survey outline / taxonomy plan
- citation integrity before submit
- no code/experiment/analyze handoff unless explicit hybrid mode

If survey workflow is blocked:

- route to researcher for survey_review repair
- route to academic_writer only after survey_review is complete
- route to reviewer for survey/paper review only after writing artifacts exist
- never route to coder for experiment stubs

---

## 7. Verification Matrix

Required new tests:

- `tests/workflow-handoff-intent.test.mjs`
- `tests/workflow-handoff-router.test.mjs`
- `tests/workflow-handoff-delivery.test.mjs`
- `tests/workflow-agent-capabilities.test.mjs`
- `tests/workflow-failure-recovery.test.mjs`
- `tests/workflow-artifact-receipts.test.mjs`
- `tests/workflow-review-round-handoff.test.mjs`
- `tests/workflow-channel-mention-delivery.test.mjs`
- `tests/workflow-lobster-delivery-e2e.test.mjs`
- `tests/workflow-write-scope.test.mjs`
- `tests/workflow-handoff-loop-guards.test.mjs`
- `tests/workflow-cross-domain-inspiration.test.mjs`
- `tests/workflow-inbound-budget.test.mjs`
- `tests/workflow-broadcast-budget.test.mjs`

Regression tests:

- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-hook-prompt-isolation.test.mjs`
- `tests/workflow-team-runtime.test.mjs`
- `tests/workflow-survey-route.test.mjs`
- `tests/workflow-writing-lines-e2e.test.mjs`
- `tests/survey-review-materializer.test.mjs`
- `npm run dashboard:test`

Loop / blocker guard cases:

- Repeated `auto_iterator_tick` with unchanged stage/owner creates one active `stage_owner_change` intent, not many.
- Terminal intents are ignored by delivery and maintenance workers.
- Unacked channel mention falls back to runtime queue once and then escalates.
- Same `failureFingerprint` cannot create duplicate active repair queue items.
- Repair task failure cannot create children beyond `maxRepairDepth`.
- Stale capability is ignored and downgraded after tool-unavailable error.
- Stale write-scope lease can be released once with event; active lease conflict does not busy retry.
- Lobster dry-run cannot mark delivery successful.
- Cross-domain missing evidence stops after `max_requisition_rounds` and produces `partial`, `waived`, or `blocked`.
- Survey route recovery never creates code/experiment/analyze handoff during blocker recovery.
- Discord/chat `auto_iterator_tick` returns compact deferred response when dispatch/broadcast would exceed inbound budget.
- Duplicate broadcast idempotency keys do not call `runtimeSubagent.run` twice.
- Oversized stage broadcast writes `workflow-broadcast-payloads/<broadcastId>.md` and posts only a compact pointer.
- `Discord inbound worker timed out` incident does not create a second stage transition or duplicate handoff.

---

## 8. Cross-Domain Inspiration Contract

### 8.1 为什么这是 workflow-owned contract

用户明确希望跨域概念搜索不是 agent 自觉行为，而是 workflow 控制面的一部分，尤其优先考虑：

- 人脑神经科学
- 认知科学
- 心理学
- 快慢思考 / dual-process theory
- System 1 / System 2
- cognitive control
- metacognition
- predictive processing
- attention gating
- working memory
- confidence monitoring
- executive control

这和 `Idea-Catalyst` 论文的核心思路一致：研究 idea / 写作故事线不应该只是后期润色，而应该从目标领域 unresolved challenge 抽象出 domain-agnostic question，再到外部领域找机制性概念，最后 recontextualize 回目标领域。

因此，这部分不能只写在 prompt 里。它必须成为 workflow-owned contract：

```text
target-domain unresolved challenge
-> domain-agnostic question
-> preferred source-domain search
-> bridge evidence
-> recontextualized mechanism
-> idea fragment
-> story spine
-> writing contract
```

### 8.2 新增 manifest block

Add to `PROJECT_MANIFEST.json`:

```json
{
  "cross_domain_inspiration": {
    "status": "missing",
    "enabled": true,
    "target_domain": null,
    "target_problem": null,
    "preferred_source_domains": [
      "Neuroscience",
      "Cognitive Science",
      "Psychology"
    ],
    "fallback_source_domains": [
      "Control Theory",
      "Sociology",
      "Behavioral Science",
      "Education",
      "Philosophy"
    ],
    "priority_concepts": [
      "dual-process theory",
      "System 1 and System 2",
      "fast and slow thinking",
      "cognitive control",
      "metacognition",
      "predictive processing",
      "attention gating",
      "working memory",
      "confidence monitoring",
      "executive control"
    ],
    "minimum_sources_per_domain": 2,
    "minimum_bridge_nodes": 3,
    "minimum_recontextualized_fragments": 2,
    "max_requisition_rounds": 2,
    "requisition_round": 0,
    "paper_nexus_retry_budget": 2,
    "allow_partial_story_usage": false,
    "allow_survey_taxonomy_enrichment_with_evidence_debt": true,
    "bridge_evidence_path": "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
    "concept_map_path": "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
    "recontextualization_path": "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
    "idea_fragment_path": "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    "storyline_bridge_path": "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    "evidence_debt_path": "researcher/ideation/CROSS_DOMAIN_EVIDENCE_DEBT.md",
    "missing_domains": [],
    "satisfied_domains": [],
    "waived_by": null,
    "waiver_reason": null,
    "blocked_reason": null,
    "last_updated_at": null
  }
}
```

### 8.3 Required status vocabulary

```text
missing
configured
searching
evidence_ready
recontextualized
story_ready
partial
waived
blocked
```

Meaning:

- `missing`: no contract exists.
- `configured`: preferred domains/concepts are configured but not searched.
- `searching`: literature discovery / PaperNexus acquisition is active.
- `evidence_ready`: enough external-domain evidence exists.
- `recontextualized`: evidence has been mapped back into target-domain mechanisms.
- `story_ready`: story bridge has been written and can be consumed by paper story.
- `partial`: evidence exists but is not strong enough for headline contribution claims; writing may use it only as motivation, limitation, taxonomy lens, or future-direction lens.
- `waived`: explicitly skipped with rationale.
- `blocked`: required cross-domain evidence is missing and cannot proceed without repair.

### 8.4 Source domain priority rule

Default priority:

```text
1. Neuroscience
2. Cognitive Science
3. Psychology
4. Control Theory
5. Sociology / Behavioral Science
6. Education / Philosophy
```

Workflow must prefer high-priority source domains unless:

- graph evidence says they are irrelevant
- user explicitly disables them
- retrieval fails and retry budget is exhausted
- project is marked as non-cross-domain / purely engineering

### 8.5 Query generation requirements

For each unresolved target challenge, generate:

- domain-specific target question
- domain-agnostic question
- at least 3 target-domain queries
- at least 3 source-domain queries per preferred domain

For neuroscience / cognition / psychology, query templates should include:

```text
<source domain> cognitive control uncertainty decision making transferable principle
dual-process theory fast slow thinking confidence monitoring <target challenge>
metacognition error monitoring adaptive control <target challenge>
predictive processing attention gating uncertainty <target challenge>
working memory consolidation interference forgetting <target challenge>
executive control inhibition switching persistence flexibility <target challenge>
```

Example for GCD / pseudo-label confirmation bias:

```text
target challenge:
  How can GCD avoid reinforcing incorrect pseudo-labels under uncertainty?

domain-agnostic question:
  How can an adaptive system decide when to trust fast approximate judgments and when to trigger slower evidence-based correction?

source-domain concepts:
  dual-process theory
  cognitive control
  confidence monitoring
  predictive processing

recontextualization:
  fast path = pseudo-label assignment
  slow path = graph / uncertainty verification
  executive gate = confidence-aware override controller
```

### 8.6 Integration with IDEA-CATALYST

Modify:

```text
tools/idea-catalyst/state.ts
tools/idea-catalyst/materializers.ts
tools/idea-catalyst/gatekeeper.ts
tools/idea-catalyst/workflow-bridge.ts
tools/literature-discovery/workflow-bridge.ts
```

Required behavior:

- If `cross_domain_inspiration.enabled = true`, IDEA-CATALYST must seed candidate domains from `preferred_source_domains`.
- Candidate domains from graph packets may add to the list but should not silently replace priority domains.
- `sourceDomains` should preserve priority order unless graph evidence strongly prunes a domain.
- `gatekeeper` must check:
  - minimum sources per preferred domain
  - minimum bridge nodes
  - minimum recontextualized fragments
- If insufficient:
  - create `INVESTIGATION_REQUISITION.json`
  - include `missing_domains`
  - include priority concepts
  - include concrete search queries
  - enqueue bounded literature discovery / PaperNexus ingestion.
- Requisition loop control:
  - increment `cross_domain_inspiration.requisition_round` before each new requisition
  - stop requisitions when `requisition_round >= max_requisition_rounds`
  - after the final round, choose `partial`, `waived`, or `blocked`; never enqueue another automatic requisition for the same `target_problem`
  - write `CROSS_DOMAIN_EVIDENCE_DEBT.md` when continuing with partial/waived evidence

Acceptance:

- If neuroscience evidence is missing and contract requires it, IDEA cannot claim `story_ready`.
- If user waives neuroscience with rationale, workflow can continue but records waiver.
- If evidence is partial, writer/reviewer must reject strong headline claims that imply source-domain proof.
- Literature discovery receives explicit target domains and priority concepts.

### 8.7 Integration with graph / PaperNexus

PaperNexus should be used for:

- source-domain paper retrieval
- source-domain concept extraction
- bridge evidence
- domain-distance / mechanism-distance cues
- storyline brief / research brief / evidence chain

Workflow-owned artifacts:

```text
researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json
researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md
researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md
researcher/idea-catalyst/INVESTIGATION_REQUISITION.json
researcher/idea-catalyst/SCOUTING_REPORT.json
researcher/idea-catalyst/IDEA_FRAGMENTS.json
researcher/idea-catalyst/RANKED_FRAGMENTS.json
```

Each bridge evidence item should include:

```ts
type CrossDomainBridgeEvidence = {
  bridgeId: string;
  sourceDomain: string;
  sourceConcept: string;
  sourcePapers: string[];
  targetChallenge: string;
  domainAgnosticQuestion: string;
  transferableMechanism: string;
  recontextualizedMechanism: string;
  evidenceStrength: "weak" | "partial" | "strong";
  limitations: string[];
};
```

### 8.8 Integration with paper story

Modify:

```text
tools/workflow-guard-materializers/paper-story-materializer.ts
tools/workflow-guard-state/paper-story.ts
tools/workflow-guard-stages/writing-stage-signals.ts
skills/academic_writer/research-paper-writing/SKILL.md
skills/reviewer/paper-review/SKILL.md
```

Paper story must consume cross-domain inspiration as:

- `CROSS_DOMAIN_STORY_BRIDGE.md`
- `MODULE_MOTIVATION_MAP.md`
- `STORY_SPINE.md`
- `CONTRIBUTION_TO_STORY_BRIDGE.md`
- `FIGURE_ANCHOR_PLAN.md`

Story spine should include:

```text
problem
-> unresolved target challenge
-> source-domain concept
-> transferable mechanism
-> target-domain adaptation
-> evidence
-> limitation
```

Example:

```text
Problem:
  GCD pseudo-labeling reinforces early mistakes.

Source-domain concept:
  Dual-process theory separates fast intuitive decisions from slower deliberative correction.

Transferred mechanism:
  Add a confidence-aware gate that decides when to trust a fast pseudo-label and when to trigger graph/evidence verification.

Target-domain adaptation:
  Fast path assigns provisional labels; slow path checks uncertainty, graph-neighbor consistency, and prototype stability.

Evidence:
  multi-seed gains, ablation on the gate, and cross-dataset validation.

Limitation:
  slow-path verification adds compute and may depend on graph freshness.
```

### 8.9 Stage gates

Experiment paper line:

- Before `idea -> plan`, if cross-domain inspiration is enabled:
  - require `cross_domain_inspiration.status in [recontextualized, story_ready, waived]`.
  - allow `partial` only if `writing_contract.cross_domain_headline_claim=false`.
  - if `blocked`, route repair to researcher.
- Before `write`, require:
  - `paper_story_state` includes source-domain bridge if headline story uses cross-domain framing.
  - if `partial`, require `CROSS_DOMAIN_EVIDENCE_DEBT.md` and reviewer-visible limitation note.

Survey line:

- Cross-domain inspiration is optional by default for survey.
- If enabled, it should enrich taxonomy / future directions, not force experiment-style idea generation.
- Survey story should consume it as:
  - taxonomy lens
  - cognitive/neuroscience interpretation layer
  - future directions

### 8.10 Handoff / failure recovery interaction

If cross-domain evidence is missing:

- Create handoff intent:
  - reason: `cross_domain_evidence_missing`
  - toRole: `researcher`
  - target action: queue literature discovery / PaperNexus acquisition
- If PaperNexus unavailable:
  - create repair intent once per requisition round
  - decrement `paper_nexus_retry_budget`
  - after budget exhaustion, set status `partial` or `blocked` and write evidence debt
  - allow waiver only with explicit rationale
- If source-domain evidence is weak:
  - keep idea/story status partial
  - prevent strong cross-domain claim in abstract/introduction
- Repeated missing-evidence handoff must use idempotency key `cross_domain_evidence_missing:{projectId}:{targetProblemHash}:{missingDomainsHash}:{requisitionRound}`.
- The same missing domain set cannot create a second active handoff in the same requisition round.

### 8.11 Tests

Add:

```text
tests/workflow-cross-domain-inspiration.test.mjs
tests/idea-catalyst-runtime-tools.test.mjs additions
tests/workflow-runtime-tools.test.mjs additions
tests/auto-iterator.test.mjs additions
tests/workflow-writing-lines-e2e.test.mjs additions
```

Required cases:

- Preferred domains default to Neuroscience / Cognitive Science / Psychology.
- Missing Neuroscience evidence triggers requisition.
- `minimum_sources_per_domain` enforced.
- `CROSS_DOMAIN_RECONTEXTUALIZATION.md` required before `story_ready`.
- Paper story consumes cross-domain bridge into `STORY_SPINE.md`.
- Weak evidence blocks strong cross-domain headline claim.
- Survey mode can use cross-domain inspiration as taxonomy/future-direction lens without entering experiment stages.

---

## 9. Final acceptance criteria

- [x] Stage owner change creates durable handoff intent.
- [x] Task completion that unlocks downstream work creates durable handoff intent.
- [x] Verification failure creates repair intent with deterministic owner.
- [x] Tool capability mismatch is detected before asking an agent to run impossible workflow actions.
- [x] Channel mention includes intent id and requires ack/claim.
- [x] Mailbox is compatibility-only, not source of truth.
- [x] Plan/review/code-review rounds are represented as handoff intents and artifact receipts.
- [x] Dashboard shows handoff and repair state.
- [x] Handoff/recovery cannot bypass experiment quality gates.
- [x] Handoff/recovery cannot push survey workflows into code/experiment/analyze.
- [x] Delivery and repair retries terminate deterministically.
- [x] Handoff status machine has explicit terminal states and rejects invalid transitions.
- [x] Default retry/ack/expiry/lease budgets live in one tested module.
- [x] Repeated auto iterator ticks do not create duplicate active handoff intents.
- [x] Repair lineage and failure fingerprints prevent repair-of-repair loops.
- [x] Stale capability records are ignored, downgraded on tool failure, and do not cause repeated impossible handoffs.
- [x] Stale write-scope leases are released by maintenance with event evidence; active conflicts do not busy retry.
- [x] Lobster remains disabled or dry-run until e2e delivery is verified.
- [x] Discord/chat inbound turns have a strict synchronous budget and defer remaining dispatch/broadcast work.
- [x] Duplicate stage/status broadcast idempotency keys do not create duplicate nested runtime runs.
- [x] Oversized workflow broadcasts are compacted with payload files instead of large inline Discord messages.
- [x] `Discord inbound worker timed out` is recorded as transport incident and never causes stage mutation by itself.
- [x] Cross-domain inspiration contract can require Neuroscience / Cognitive Science / Psychology priority search.
- [x] Missing required source-domain bridge evidence creates recovery handoff instead of relying on agent prompt memory.
- [x] Cross-domain requisition stops after bounded rounds and resolves to `story_ready`, `partial`, `waived`, or `blocked`.
- [x] Cross-domain concepts are consumed by paper story before writer uses them as headline narrative.

Implementation evidence:

- `npm run build` passes (`tsc`, dist preparation, runtime import verification).
- `npm run dashboard:test` passes.
- `node --test tests/workflow-cross-domain-inspiration.test.mjs tests/workflow-handoff-intent.test.mjs tests/workflow-handoff-delivery.test.mjs tests/workflow-handoff-loop-guards.test.mjs tests/workflow-handoff-ack.test.mjs tests/workflow-failure-recovery.test.mjs tests/workflow-artifact-receipts.test.mjs tests/workflow-review-round-handoff.test.mjs tests/workflow-broadcast-budget.test.mjs tests/workflow-inbound-budget.test.mjs tests/workflow-runtime-maintenance.test.mjs tests/stage-broadcast.test.mjs tests/agent-task-dispatch.test.mjs tests/workflow-task-claim.test.mjs tests/e2e-paper-generation-harness.test.mjs tests/workflow-runtime-tools.test.mjs` passes.
- `PATH=/opt/homebrew/bin:$PATH node --test --test-concurrency=1 tests/auto-iterator.test.mjs` passes.
- `PATH=/opt/homebrew/bin:$PATH node --test --test-concurrency=1 tests/workflow-service.test.mjs tests/workflow-hook-prompt-isolation.test.mjs` passes.
- `npx tsc --noEmit --pretty false --project tsconfig.json` reports 0 diagnostics.
- Full coverage notes: delivery ladder is now used by auto-stage dispatch; capability-aware dispatch skips stale sessions; task claims enforce write-scope; code review creates handoff intents and artifact receipts; cross-domain contract participates in idea/write/story gates; Discord inbound timeout is recorded as a runtime incident.

---

## 10. Real End-to-End AutoResearch Paper Generation Test Protocol

This section is the real-world validation plan for the question:

```text
Can the current AutoResearch workflow start from a research topic and produce a reviewable paper draft end-to-end?
```

Unit tests and integration tests are not enough. The workflow must be validated through a live disposable project that exercises project binding, agent handoff, PaperNexus graph readiness, cross-domain inspiration, writing constraints, citation constraints, figure constraints, and failure recovery.

### 10.1 Test lanes

Run three lanes. Do not treat lane A alone as proof that experiment-paper automation works.

| Lane | Goal | External dependencies | Expected runtime | Pass definition |
| --- | --- | --- | --- | --- |
| A. Survey E2E | Prove survey pipeline can produce a reviewable survey draft without entering code/experiment. | PaperNexus graph/search, writer/reviewer agents. | 2-6 hours. | Survey draft exists with taxonomy, SOTA matrix, references, citation report, and no code/experiment stage drift. |
| B. Experiment Smoke E2E | Prove experiment pipeline can traverse idea -> plan -> code -> experiment -> analyze -> write using a tiny bounded experiment. | PaperNexus graph/search, local or remote lightweight experiment runner. | 4-12 hours. | Paper draft exists with at least one completed experiment, result table/figure, claim map, and review packet. |
| C. Full Live E2E | Prove production-like autonomous research can run with real PaperNexus, cross-domain search, handoff recovery, and writing constraints. | PaperNexus remote MCP/API, GPU/remote runner if experiment paper, Discord/OpenClaw runtime. | 1-3 days. | Workflow reaches `write` or `submit` with all required quality gates and no unresolved critical runtime incidents. |

Current live status:

- Lane A survey E2E: passed on 2026-04-12 (`e2e-survey-gcd-neuro-cog-20260412`)
- Lane B experiment smoke E2E: passed on 2026-04-12 (`e2e-exp-gcd-confirmation-bias-20260412`)
- Natural survey route smoke: passed on 2026-04-12 (`e2e-survey-reasoning-smoke-20260412`)
- Lane C full live E2E: not yet executed

### 10.2 Disposable project setup

Use a disposable projects root and never run the E2E test against a user production project.

```text
OPENCLAW_PROJECTS_ROOT=/tmp/openclaw-e2e-projects
E2E_CHANNEL=discord:channel:<test-channel-id>
E2E_PROJECT_SURVEY=e2e-survey-gcd-neuro-cog-YYYYMMDD
E2E_PROJECT_EXPERIMENT=e2e-exp-gcd-confirmation-bias-YYYYMMDD
```

Preflight checks:

- `npm run build` passes.
- `npm run dashboard:test` passes.
- `npx tsc --noEmit --pretty false --project tsconfig.json` reports 0 diagnostics.
- Workflow plugin can resolve the test projects root.
- Runtime subagent API is available.
- Test channel binding can be created and refreshed without session restart.
- PaperNexus access mode is known:
  - `remote_mcp` preferred.
  - `remote_api` acceptable.
  - local graph fallback is not acceptable for lane C.
- If Discord is used, inbound worker timeout incidents must be visible under `.openclaw-research/workflow-runtime-incidents.json`.

### 10.3 Lane A: Survey E2E script

Topic:

```text
Survey topic: Generalized Category Discovery with graph evidence, confirmation bias, and neuro-cognitive inspiration.
Paper mode: survey
Venue target: TPAMI-style survey draft
Cross-domain inspiration: enabled
Preferred source domains: Neuroscience, Cognitive Science, Psychology
```

Required execution flow:

1. Create project and bind test channel.
2. Set durable identity:
   - `workflow_line=survey`
   - `paper_type=survey`
   - `writing_contract.paper_mode=survey`
   - `cross_domain_inspiration.enabled=true`
3. Run graph/literature acquisition:
   - queue a bounded literature discovery request
   - ingest 30-60 target-domain papers
   - ingest at least 6 source-domain papers, with at least 2 neuroscience papers
4. Run survey review:
   - `SURVEY_QUERY_REGISTRY.json`
   - `INCLUDED_PAPERS.json`
   - `EXCLUDED_PAPERS.json`
   - `LITERATURE_REVIEW.md`
   - `SOTA_MATRIX.md`
   - `GAP_SYNTHESIS.md`
   - `COVERAGE_SUMMARY.md`
   - `SURVEY_BRIEF.md`
5. Run cross-domain materialization:
   - `CROSS_DOMAIN_BRIDGE_EVIDENCE.json`
   - `NEURO_COGNITIVE_CONCEPT_MAP.md`
   - `CROSS_DOMAIN_RECONTEXTUALIZATION.md`
   - `CROSS_DOMAIN_EVIDENCE_DEBT.md` only if evidence is partial/waived
6. Run paper story materialization:
   - `STORY_SPINE.md`
   - `MODULE_MOTIVATION_MAP.md`
   - `CROSS_DOMAIN_STORY_BRIDGE.md`
7. Run writing:
   - `academic_writer/PAPER_PLAN.md`
   - `academic_writer/paper/main.tex`
   - section files under `academic_writer/paper/sections/`
   - `academic_writer/paper/refs.bib`
8. Run review:
   - citation verification
   - figure QC if figures exist
   - reviewer issue tracker

Survey lane pass criteria:

- Workflow never enters `code`, `experiment`, or `analyze` unless explicit hybrid mode is set.
- No coder handoff intent is created.
- `PROJECT_MANIFEST.json.current_stage` reaches `write`, `review`, `submit`, or `done`.
- `academic_writer/paper/main.tex` exists and references real included papers.
- `SOTA_MATRIX.md` has representative method rows.
- `CROSS_DOMAIN_STORY_BRIDGE.md` is consumed in `STORY_SPINE.md` if cross-domain inspiration is enabled.
- No `discord_inbound_timeout` incident remains open after maintenance replay.
- `workflow-handoff-intents.json` has no active stale `delivered`, `claimed`, `failed`, or `stale_claim` item older than its budget.

### 10.4 Lane B: Experiment Smoke E2E script

Topic:

```text
Experiment topic: Mitigating pseudo-label confirmation bias in generalized category discovery with a confidence-aware slow/fast verification gate.
Paper mode: conference
Experiment budget: tiny smoke run only
```

Required execution flow:

1. Create project and bind test channel.
2. Run target-domain graph/literature acquisition with 20-40 papers.
3. Enable cross-domain inspiration and require at least neuroscience + cognitive science evidence.
4. Run idea/frontier/plan:
   - `IDEA_REPORT.md`
   - `IDEA_AUDIT.md`
   - `TRACK_REGISTRY.json` with 1 active track
   - `orchestrator/PLAN.md`
   - `orchestrator/TODOS.md`
   - `orchestrator/PLAN_AUDIT.md`
5. Run code:
   - one structured experiment bundle under `coder/experiments/<track-id>/<experiment-id>__<slug>/`
   - `train.py`
   - `README.md`
   - `EXPERIMENT_MANIFEST.json`
   - `coder/EXPERIMENT_INDEX.md`
6. Run code review:
   - code review handoff intents created for all panel reviewers
   - artifact receipts created for reviewer outcomes
   - repair handoff created if review fails
7. Run experiment:
   - bounded toy/local/remote run completes
   - result artifact exists under `researcher/artifacts/results/`
   - `EXPERIMENT_LEDGER.json` records completed run
   - one plot/table artifact exists
8. Run analyze:
   - claim-evidence matrix
   - ablation/mechanism notes if required
   - result summary packet
9. Run write/review:
   - `STORY_SPINE.md`
   - `academic_writer/paper/main.tex`
   - citations and figure QC pass or record explicit debt

Experiment smoke pass criteria:

- At least one experiment result is real, not a stub artifact created only to satisfy a gate.
- The paper draft contains at least one result table or figure tied to `EXPERIMENT_LEDGER.json`.
- Code review handoff and receipts are visible in `.openclaw-research`.
- No quality gate is bypassed by manually editing `current_stage`.
- If cross-domain evidence is partial, the abstract/introduction cannot make it a strong headline claim.

### 10.5 Lane C: Full Live E2E script

Lane C should run only after lanes A and B pass.

Required additions over lane B:

- Use real remote PaperNexus service, not local fallback.
- Use real source-domain PaperNexus retrieval for neuroscience/cognitive/psychology bridge papers.
- Use real experiment runner if the project is experiment-mode.
- Run workflow through Discord/OpenClaw rather than only direct Node tests.
- Run with heartbeat/service maintenance enabled for at least 2 maintenance cycles after final writing.
- Keep dashboard open/readable during execution.

Full live pass criteria:

- No channel binding loss after channel/project bind.
- No unresolved `discord_inbound_timeout` incident after maintenance pass.
- No duplicate stage broadcast for the same idempotency key.
- No active handoff intent older than its budget.
- No active write-scope lock after all sessions complete.
- No repair queue item remains `queued`, `claimed`, or `failed` without escalation/owner.
- Paper draft exists with references, figures/tables if applicable, and reviewer report.
- If `submit` is blocked, it is blocked only by an explicit human final gate or reviewer issue, not by missing workflow artifacts.

### 10.6 E2E evidence bundle

Every E2E run must create:

```text
{PROJ}/.openclaw-research/E2E_RUN_REPORT.md
{PROJ}/.openclaw-research/E2E_STATE_TIMELINE.jsonl
{PROJ}/.openclaw-research/E2E_ARTIFACT_CHECKLIST.json
```

`E2E_RUN_REPORT.md` must include:

- start/end timestamps
- project id/root
- lane type
- PaperNexus mode and endpoint class
- stage timeline
- handoff counts by status
- repair queue summary
- capability warning summary
- write-scope summary
- generated paper files
- citation/figure QC status
- final verdict: `pass`, `partial`, or `fail`

### 10.7 Automation guardrails for the E2E run

- Do not use production project roots.
- Do not manually edit `current_stage`.
- Do not create stub experiment results to pass experiment gates.
- Do not accept local PaperNexus fallback for lane C.
- Do not ignore open high/critical review issues.
- If the run times out, capture state and stop; do not loop indefinitely.
- If a handoff fails, recovery must go through durable handoff/repair state, not ad hoc chat @mentions.

---

## 11. Remaining TODOs From Coverage Audit

These TODOs are required before claiming production-grade E2E paper generation. Implementation tasks below are now covered by code and automated tests; live Lane A/B/C runs remain the final production proof before using the workflow on a real project.

### 11.1 Complete delivery ladder main-path coverage

- [x] Use full delivery ladder by default for handoff intents: `native_runtime -> lobster/dry-run-or-enabled -> channel_broadcast -> runtime_queue -> mailbox_compat -> human_escalation`.
- [x] Stop using `channels: ["native_runtime"]` for auto-stage handoff except in explicit smoke mode.
- [x] Add real `channelBroadcast`, `runtimeQueue`, and `mailboxCompat` callbacks to `deliverWorkflowHandoffIntent`.
- [x] Ensure every fallback appends a delivery attempt to `workflow-handoff-intents.json`.
- [x] Add E2E test where native dispatch fails and runtime queue fallback succeeds.
- [x] Add E2E test where every automatic channel fails and `human_escalation` becomes terminal.

### 11.2 Harden handoff ack/claim authority

- [x] `ack_handoff_intent` must verify target role/session or researcher/admin override.
- [x] `claim_handoff_intent` must reject wrong owner unless researcher/admin override is explicit.
- [x] `claim_handoff_intent` must claim `targetTaskId` in `workflow-task-graph.json` when present.
- [x] Claim must record capability snapshot, not only session key.
- [x] Add `tests/workflow-handoff-ack.test.mjs`.
- [x] Add regression for stale claim -> fallback owner -> escalation.

### 11.3 Finish repair lifecycle closeout

- [x] Repair task completion must close matching `workflow-repair-queue.json` item.
- [x] Repair task failure must decrement retry budget.
- [x] Same verification failure must reuse the same repair item, not spawn a child.
- [x] Different failure kind may create child repair only if `repairDepth < maxRepairDepth`.
- [x] Exhausted repair must create visible `human_escalation` handoff intent.
- [x] Add `tests/workflow-failure-recovery.test.mjs`.
- [x] Add E2E assertion: no non-terminal repair item remains after successful paper draft generation.

### 11.4 Deepen cross-domain PaperNexus / IDEA-CATALYST integration

- [x] IDEA-CATALYST candidate domains must seed from `cross_domain_inspiration.preferred_source_domains`.
- [x] Graph packet candidate domains may add to preferred domains but must not silently replace Neuroscience/Cognitive Science/Psychology priority.
- [x] Gatekeeper must enforce `minimum_sources_per_domain`, `minimum_bridge_nodes`, and `minimum_recontextualized_fragments`.
- [x] Missing evidence must materialize `INVESTIGATION_REQUISITION.json` with missing domains, priority concepts, and concrete PaperNexus queries.
- [x] Literature discovery bridge must receive preferred source domains and priority concepts.
- [x] PaperNexus result processing must materialize `CROSS_DOMAIN_BRIDGE_EVIDENCE.json`, `NEURO_COGNITIVE_CONCEPT_MAP.md`, and `CROSS_DOMAIN_RECONTEXTUALIZATION.md`.
- [x] After `max_requisition_rounds`, workflow must choose `partial`, `waived`, or `blocked`, and write `CROSS_DOMAIN_EVIDENCE_DEBT.md`.
- [x] Add tests that missing neuroscience evidence creates a PaperNexus requisition, not just a gate blocker.

### 11.5 Make inbound budget global and coalesced

- [x] Wrap all Discord/chat workflow actions in `withWorkflowInboundBudget`, not only `auto_iterator_tick`.
- [x] Coalesce duplicate inbound turns for the same `{projectId, channelKey, action}` inside an active budget window.
- [x] On budget exhaustion, always enqueue remaining work and return compact response.
- [x] Maintenance must replay pending outbox/queue work without rerunning stage mutation.
- [x] If `Discord inbound worker timed out` is observed outside nested broadcast catch blocks, record `discord_inbound_timeout` incident from the outer adapter path.
- [x] Add test for duplicate user pings coalescing to one inbound turn.

### 11.6 Complete broadcast supersede strategy

- [x] If live state already moved past a broadcast's `stageAfter`, mark old broadcast `superseded` instead of posting it.
- [x] If a regression and advancement happen inside one budget window, post only latest live snapshot summary.
- [x] Long blocker/action/participant details must always become payload files.
- [x] Add test where repeated `code -> plan -> code -> experiment` within one window posts only the latest stable summary.

### 11.7 PaperNexus retry terminal recovery

- [x] When retry background run reaches terminal state, refresh graph presence automatically.
- [x] Remaining retry failures must create `paper_ingestion_failed` repair handoff.
- [x] Already-in-graph failures must be marked completed/waived, not requeued.
- [x] Retry terminal state must not require a user to ask for status before repair routing happens.
- [x] Add E2E test for 33 failed imports style recovery: sequential retry -> remaining failures -> repair handoff.

### 11.8 E2E paper generation harness

- [x] Add script or documented command sequence to run Lane A survey E2E.
- [x] Add script or documented command sequence to run Lane B experiment smoke E2E.
- [x] Materialize `E2E_RUN_REPORT.md`, `E2E_STATE_TIMELINE.jsonl`, and `E2E_ARTIFACT_CHECKLIST.json`.
- [x] Add dashboard link / artifact tab for E2E run report.
- [x] Define stop conditions so E2E cannot loop indefinitely.

### 11.9 Citation calibration with Reffix + bibtex-dblp

- [x] Add a repo-local citation calibration script that uses `reffix` and `bibtex-dblp` when available.
- [x] Emit both machine-readable (`.json`) and reviewer-readable (`.md`) calibration reports.
- [x] Mark placeholder authors, missing year/title, and missing provenance as suspicious or hallucinated.
- [x] Document the calibration flow in writer-side `/citation-preflight`.
- [x] Document the calibration flow in reviewer-side `/citation-integrity-gate`.
- [x] Integrate the calibration step into a workflow-owned runtime action or automatic pre-submit lane so it runs as part of the standard paper pipeline without manual shell invocation.
- [x] Run the calibration step inside a full live Lane C execution and verify that the final citation report remains `Suspicious: 0`, `Hallucinated: 0`.

Implementation note:

- `research_workflow.run_citation_calibration` exists, is schema-registered, and passes automated tool tests.
- 2026-04-12 live Lane C project validation (`/workspace/AutoResearchProjects/e2e-live-survey-2603-12226-20260412`) completed through the workflow-owned runtime surface and produced `Suspicious: 0`, `Hallucinated: 0`, with refreshed `reviewer/CITATION_CALIBRATION.{json,md}` and `reviewer/CITATION_VERIFICATION.md`.
- Real runtime behavior showed `reffix` succeeding and `update_from_dblp` stalling long enough to require a per-tool timeout. The runtime now treats that stall as bounded `needs_review` evidence debt instead of hanging the entire lane.
- Live `openclaw agent` CLI invocations were still prone to going silent in non-interactive automation paths, so the production proof here was executed via the same registered runtime action surface that the workflow tool uses, rather than relying on a chat-turn wrapper.

### 11.10 Non-interactive OpenClaw agent CLI hang hardening

- [x] Add a repo-local safe wrapper for `openclaw agent` that returns structured JSON instead of hanging forever when the child stays silent.
- [x] Model the failure as `timed_out_silent` with explicit `startupGraceSeconds`, `silenceTimeoutSeconds`, `durationMs`, and captured `stdout` / `stderr`.
- [x] Add tests for both the normal-output path and the silent-timeout path.

Implementation note:

- The hardening lives in `scripts/openclaw_agent_safe.mjs`.
- This does not change OpenClaw core behavior; it adds a workflow-side automation wrapper so non-interactive invocations stop being opaque.
- The wrapper is intentionally explicit rather than silently retrying, so future automation can decide whether to fall back to a runtime-tool path or escalate.
- 2026-04-12 live probe still showed the underlying non-interactive slash-command transport going `timed_out_silent` for `/show-commands`, so a repo-local fallback runner `scripts/run_local_workflow_command.mjs` was added for direct command-handler execution during real validation / debugging. This does not replace fixing OpenClaw transport itself; it prevents handler-level verification from being blocked by transport silence.

### 11.11 Local PDF -> remote PaperNexus staging hardening

- [x] Add a workflow-owned remote staging helper that uploads project-local Markdown/PDF sources to a remote host over SSH.
- [x] Add a runtime action to invoke that helper through `research_workflow` instead of requiring ad hoc manual SSH commands.
- [x] Support manifest rewrite so staged batch manifests can carry `server_file_path` for remote-only PaperNexus import flows.
- [x] Add tests for the raw staging helper and the workflow runtime action.

Implementation note:

- The hardening lives in `scripts/papernexus_remote_stage.py` plus `tools/papernexus-remote-stage.ts`.
- `research_workflow.stage_papernexus_remote_sources` writes a durable `researcher/paper-staging/REMOTE_PAPERNEXUS_STAGE.json` report and can emit a sibling `*.remote.json` manifest with remote `server_file_path` fields.
- This is a workflow-owned staging primitive, not a silent auto-side-effect inside `queue_paper_ingestion`; explicit invocation keeps remote uploads observable and reversible.

### 11.12 Next Priority: Stable experiment tuning + innovation-validity decision system

This is the next implementation priority after the handoff/recovery hardening pass.

Goal:

- make parameter tuning reliable enough to support high-throughput experiment search
- separate "the experiment is still under-tuned" from "the innovation itself is weak"
- stop relying on agents to babysit experiment completion
- promote or discard candidates through a deterministic contract instead of ad hoc interpretation

Why this is the next priority:

- the current workflow already has most of the right primitives (`EXPERIMENT_SEARCH_SPEC.json`, `experiment_search`, git-native candidate/incumbent actions, monitor flow, multi-agent review)
- but it still lacks a fully stable outer decision layer that can distinguish implementation instability, under-searched parameter neighborhoods, and genuine innovation invalidation
- this is now the main blocker between "search loop exists" and "search loop is trustworthy"

#### 11.12.1 Non-negotiable design principles

- [x] **Agents must not be the primary experiment completion detector.** Completion should be derived from durable runtime artifacts first, and only interpreted by agents second.
- [x] **Scientific judgment and parameter search must be split into two layers.** The inner loop may search; the outer loop decides whether the hypothesis still deserves search.
- [x] **No innovation invalidation without clean evidence.** If baseline fairness, implementation stability, multi-seed, or ablation are not yet clean, the system must not conclude that the innovation is invalid.
- [x] **Secondary diagnostics cannot promote candidates unless explicitly declared primary.** Better curves, nicer runtime, lower variance, or smaller train/val gaps may guide the next candidate, but they cannot keep a commit by themselves unless the search contract says so.
- [x] **All keep/discard/rollback decisions must be durable.** No conclusion may exist only in chat memory.

#### 11.12.2 Required architecture

The implementation should be refactored into three layers:

1. **Execution watcher layer**
   - responsible only for detecting whether a run is alive, terminal, crashed, timed out, or result-stable
   - must be service/runtime-owned, not agent-owned
2. **Bounded search loop**
   - responsible for candidate branch/worktree creation, one-change-per-trial execution, and promote/discard
   - should be coder-owned and git-native
3. **Scientific decision layer**
   - responsible for determining whether the workflow should continue tuning, narrow search, run ablation, require multi-seed, repair implementation, or invalidate the innovation
   - must be deterministic and state-backed

#### 11.12.3 Execution watcher hardening

- [x] Introduce durable watcher artifacts per active run, e.g. `RUN_HEARTBEAT.json`, `RUN_TERMINAL.json`, `RESULT_SUMMARY.json`, and `FAILURE_SIGNATURE.json`.
- [x] Make `tools/workflow-gpu-monitor.ts` or a sibling runtime module treat `screen -ls` / GPU idle as secondary evidence, not the only completion signal.
- [x] Completion must be resolved from this priority order:
  1. explicit terminal artifact
  2. result bundle exists and is stable
  3. screen missing + GPU idle + no active process
  4. timeout
- [x] `/monitor-experiment` should become a reconciliation/interpretation surface, not the primary watcher.
- [x] Add tests that a run can finish without any foreground agent still being alive, and the workflow still converges to the correct terminal experiment state.

#### 11.12.4 Bounded search loop hardening

- [x] Keep the current git-native incumbent/candidate model, but make it the default path when an approved `EXPERIMENT_SEARCH_SPEC.json` exists.
- [x] Ensure candidate worktree creation, promotion, and discard remain workflow-owned and review-gated.
- [x] Record every trial in `EXPERIMENT_LEDGER.json`, including:
  - candidate lineage
  - base commit
  - promoted commit
  - discard reason
  - failure class
  - search session id
- [x] Make `SEARCH_STATE.json` / `experiment_search` carry enough information to resume mid-search without ambiguity.

#### 11.12.5 Scientific decision layer

- [x] Add a deterministic decision engine, e.g. `tools/workflow-experiment-decision.ts`.
- [x] This engine must output one of:
  - `repair_implementation`
  - `continue_tuning`
  - `narrow_search`
  - `require_multi_seed`
  - `require_ablation`
  - `innovation_fragile`
  - `innovation_supported`
  - `innovation_invalidated` / explicit rollback normalization
  - `rollback_to_plan`
  - `rollback_to_idea`
- [x] The engine must consume:
  - `EXPERIMENT_SEARCH_SPEC.json`
  - `experiment_search`
  - `EXPERIMENT_LEDGER.json`
  - experiment review state
  - monitor state
  - distilled experiment memory packet
- [x] The engine must never emit `innovation_invalidated` unless all of the following are true:
  - baseline fairness is clean
  - implementation confidence is high
  - multi-seed is ready
  - ablation is ready
  - repeated candidate failures are scientifically attributable

Implementation note:

- `tools/workflow-experiment-decision.ts` now exists and is exposed through `research_workflow.evaluate_experiment_search_decision`.
- The current implementation now distinguishes `repair_implementation`, `continue_tuning`, `narrow_search`, `require_multi_seed`, `require_ablation`, `innovation_supported`, `innovation_fragile`, `rollback_to_plan`, `rollback_to_idea`, and `reconcile_runtime`.
- `auto_iterator` now consumes this decision to:
  - keep EXPERIMENT from falsely auto-advancing to ANALYZE
  - hand bounded repair work to `Coder`
  - hand reconciliation / multi-seed / ablation back to `Researcher`
  - rollback explicitly to `plan` / `idea` and sync `orchestration_state`
- `register-workflow-service.ts` now also tailors experiment auto-stage handoff bodies so monitor/reconcile vs repair vs decision-follow-up are not collapsed into the same generic dispatch text.
- The decision engine now also consumes experiment review blockers plus the durable experiment-memory digest, so unresolved review blockers or unsynced experiment memory can keep the workflow in repair/reconcile mode instead of over-advancing.
- `tools/workflow-gpu-monitor.ts` now implements the completion ladder explicitly: terminal artifact first, then stable `RESULT_SUMMARY.json`, then idle/missing-screen heuristic, then stale-heartbeat timeout.
- `tools/workflow-runtime-maintenance.ts` now refreshes experiment monitor state plus persists the latest experiment decision during maintenance passes, so completion / routing can converge without a foreground agent still being alive.
- Handoff check result:
  - the previous bug where experiment decision changed `ownerAfter` but still stayed stuck in `background` because stage signals remained has now been fixed by letting experiment decision own the next dispatchable step
  - the remaining broader caveat is that non-experiment stages still use the older "missing stage signals vs drive_stage dispatch" policy, so this next-priority work is stable for experiment routing first, not yet a universal stage-handoff rewrite
- Dedicated clean tests now cover:
  - bounded repair handoff to `Coder`
  - rollback handoff to `Orchestrator`
  - review-blocker-aware decision routing
  - stable-result-summary and stale-heartbeat completion detection
  - runtime-maintenance-driven monitor refresh + decision persistence without a foreground agent
  - service-side automatic `Coder /search-experiment` dispatch for experiment auto loops

Bounded search loop note:

- The git-native search loop already routes through `research_workflow.request_experiment_git_op` / `apply_experiment_git_op`, and dedicated runtime tests cover:
  - multi-agent review before candidate worktree creation / promotion
  - reviewed discard that removes retained git state while preserving workflow-owned search memory
  - promotion guard that refuses retention when the recorded basis only cites configured non-promotion signals
  - ledger metadata for `searchSessionId`, candidate lineage, discard reason, and failure class
- Stage guidance / prompt assembly / `resume-pipeline` already prefer `/search-experiment` when an approved `EXPERIMENT_SEARCH_SPEC.json` exists.

#### 11.12.6 State model upgrades

- [x] Extend `EXPERIMENT_SEARCH_SPEC.json` with explicit fields for:
  - `primary_metric_contract`
  - `baseline_fairness_contract`
  - `required_validation_steps`
  - `innovation_invalidity_criteria`
  - `tuning_exhaustion_criteria`
  - `search_ladder`
- [x] Extend `experiment_search` / `SEARCH_STATE.json` with:
  - `validation_stage`
  - `baseline_fairness_status`
  - `implementation_confidence`
  - `search_exhaustion_status`
  - `ablation_status`
  - `innovation_status`
  - `decision_confidence`
  - `recommended_next_action`
  - `failure_cluster_ids`
  - `evidence_cleanliness_status`
- [x] Preserve backward compatibility for legacy experiment projects that only know `status`, `multi_seed_status`, and `plot_pack_status`.

Implementation note:

- `workflow-status` / snapshot now surface these fields, so users can inspect the decision state without opening raw JSON files.

#### 11.12.7 Rollback policy

- [x] Rollback must become explicit and durable, not implied by chat guidance.
- [x] The system must distinguish:
  - rollback because implementation is untrusted
  - rollback because baseline fairness is broken
  - rollback because the search envelope is exhausted
  - rollback because the innovation itself has been invalidated
- [x] Every rollback should record:
  - trigger
  - source evidence
  - target stage
  - recommended next owner

#### 11.12.8 Monitoring / throughput policy

- [x] The workflow should support high-throughput candidate search without forcing long-lived foreground turns.
- [x] Background monitor passes must stay bounded and resumable.
- [x] Completion detection should be able to keep up with multiple active runs on one or more servers.
- [x] `experiment_search` should expose whether the next best action is:
  - launch another candidate
  - wait for more evidence
  - reconcile finished runs
  - stop and reflect

#### 11.12.9 Acceptance criteria for this next phase

- [x] A reviewed search envelope can drive multiple candidate trials without human babysitting.
- [x] Non-promoted candidates are discarded from retained git history but preserved in durable search/ledger memory.
- [x] The workflow can explain why a candidate was discarded in one of three categories: runtime failure, implementation failure, or scientific failure.
- [x] The workflow does not call an innovation invalid before baseline fairness, multi-seed, and ablation are complete.
- [x] The workflow can continue tuning when evidence is inconclusive, narrow search when the neighborhood is poor, and rollback when the innovation is truly weak.
- [x] Experiment completion is derived from durable watcher/runtime signals, not only from an agent noticing that a `screen` disappeared.
