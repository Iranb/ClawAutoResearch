# Workflow-Owned Handoff / Failure Recovery 代码执行计划

> **Status:** CODE EXECUTION PLAN

> **Non-negotiable:** 本计划不改变现有 workflow stage truth，不让 Team Lead 自由拆任务，不把 mailbox 重新变成核心 handoff 机制。`auto_iterator_tick`、stage registry、role policy、manifest/gate/runtime state 仍是控制面真相源。新增代码只能围绕 **durable handoff intent + delivery + ack + recovery** 增强现有 pipeline。

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
  | "manual_recovery";

export type WorkflowHandoffStatus =
  | "pending"
  | "dispatching"
  | "delivered"
  | "acknowledged"
  | "claimed"
  | "completed"
  | "failed"
  | "expired"
  | "superseded";

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
  status: WorkflowHandoffStatus;
  deliveryPlan: WorkflowHandoffDeliveryPlan;
  deliveryAttempts: WorkflowHandoffDeliveryAttempt[];
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
  originalOwner: string | null;
  repairOwner: string;
  fallbackOwners: string[];
  retryBudgetRemaining: number;
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
  lastSeenAt: string;
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
  - pending -> dispatching -> delivered -> acknowledged -> claimed -> completed
  - pending/dispatching/delivered -> failed
  - pending/delivered -> expired
  - any non-terminal -> superseded
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
  2. Lobster if enabled
  3. channel broadcast mention
  4. runtime queue
  5. mailbox compatibility note
  6. human escalation event
- Each attempt appends to intent deliveryAttempts.
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
- Mailbox note is written only as compatibility attempt.
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
- Stage owner handoff may be acked without task claim.

Tests:

- Target owner can ack intent.
- Wrong owner cannot claim unless researcher/admin role.
- Claiming task intent claims task graph entry.

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
- In `completeWorkflowTaskAndContinue`, when verification fails:
  - create failure record
  - create repair queue item
  - create handoff intent to repair owner
  - optionally keep original task claimed until repair owner claims repair task
- Retry budget defaults:
  - verification_failed: 2
  - code_review_failed: 2
  - plan_inconsistent: 2
  - paper_ingestion_failed: 3
  - exec_approval_required: 1 then human escalation
- Exhausted retry budget -> urgent human escalation intent.

Tests:

- Failed verification creates repair queue item.
- Repair owner deterministic by failure kind.
- Retry budget decrements.
- Exhausted repair escalates.

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
- On tool execution, refresh `canUseResearchWorkflow=true`.
- Handoff delivery should select capable session for workflow actions.
- If target foreground lacks tool, route to capable same-role session or researcher fallback.

Tests:

- Capability heartbeat persists.
- Tool action updates capability.
- Handoff for `queue_paper_ingestion_retry` avoids session without research_workflow.

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
- Before claim, detect active conflicting claims.
- Always exclusive:
  - `PROJECT_MANIFEST.json`
  - `TRACK_REGISTRY.json`
  - `.openclaw-research/workflow-task-graph.json`
  - `.openclaw-research/workflow-handoff-intents.json`
- Allow read-only parallel claims.

Tests:

- Conflicting exclusive task claim is blocked.
- Read-only task claim is allowed.
- Lead/researcher override requires explicit flag and event.

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
    "bridge_evidence_path": "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
    "concept_map_path": "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
    "recontextualization_path": "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
    "idea_fragment_path": "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    "storyline_bridge_path": "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    "missing_domains": [],
    "satisfied_domains": [],
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

Acceptance:

- If neuroscience evidence is missing and contract requires it, IDEA cannot claim `story_ready`.
- If user waives neuroscience with rationale, workflow can continue but records waiver.
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
  evidenceStrength: \"weak\" | \"partial\" | \"strong\";
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
  - if `blocked`, route repair to researcher.
- Before `write`, require:
  - `paper_story_state` includes source-domain bridge if headline story uses cross-domain framing.

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
  - create repair intent
  - allow waiver only with explicit rationale
- If source-domain evidence is weak:
  - keep idea/story status partial
  - prevent strong cross-domain claim in abstract/introduction

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
\n## 9. Final acceptance criteria

- [ ] Stage owner change creates durable handoff intent.
- [ ] Task completion that unlocks downstream work creates durable handoff intent.
- [ ] Verification failure creates repair intent with deterministic owner.
- [ ] Tool capability mismatch is detected before asking an agent to run impossible workflow actions.
- [ ] Channel mention includes intent id and requires ack/claim.
- [ ] Mailbox is compatibility-only, not source of truth.
- [ ] Plan/review/code-review rounds are represented as handoff intents and artifact receipts.
- [ ] Dashboard shows handoff and repair state.
- [ ] Handoff/recovery cannot bypass experiment quality gates.
- [ ] Handoff/recovery cannot push survey workflows into code/experiment/analyze.
- [ ] Delivery and repair retries terminate deterministically.
- [ ] Cross-domain inspiration contract can require Neuroscience / Cognitive Science / Psychology priority search.
- [ ] Missing required source-domain bridge evidence creates recovery handoff instead of relying on agent prompt memory.
- [ ] Cross-domain concepts are consumed by paper story before writer uses them as headline narrative.
