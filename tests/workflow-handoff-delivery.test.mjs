import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { deliverWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-delivery.ts";
import {
  readWorkflowHandoffIntentStore,
  upsertWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";

test("deliverWorkflowHandoffIntent records native delivery as dispatched instead of prematurely completing the handoff", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-native",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return {
          ok: true,
          runId: "run-1",
          sessionKey: "agent:coder:main",
        };
      },
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.intent.status, "dispatched");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts[0].channel, "native_runtime");
  assert.equal(store.intents[0].deliveryAttempts[0].status, "delivered");
});

test("deliverWorkflowHandoffIntent treats Lobster dry-run as non-delivery", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-lobster-dry-run",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["lobster"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    lobsterMode: "dry_run",
    runtime: {
      async lobsterDispatch() {
        return {
          ok: true,
          dryRun: true,
        };
      },
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.intent.status, "failed");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts[0].status, "skipped");
});

test("deliverWorkflowHandoffIntent falls back from native failure to runtime queue", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-native-to-queue",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime", "runtime_queue"],
      maxAttemptsTotal: 3,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return { ok: false, error: "runtime unavailable" };
      },
      async runtimeQueue() {
        return { ok: true, queueKey: "queue-1" };
      },
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.intent.status, "queued");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.deepEqual(
    store.intents[0].deliveryAttempts.map((attempt) => [attempt.channel, attempt.status]),
    [
      ["native_runtime", "failed"],
      ["runtime_queue", "delivered"],
    ]
  );
});

test("deliverWorkflowHandoffIntent suppresses stale hook-gated handoffs before delivery", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-hook-gate-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        workflow_hooks: {
          enabled: true,
          audit_hooks: [
            {
              hook_id: "delivery-gate",
              hook_type: "file_audit",
              stage: "write",
              hook_point: "before_handoff_delivery",
              target_role: "academic_writer",
              auditor_role: "reviewer",
              file_path: "academic_writer/paper/main.tex",
              requirement_prompt: "Check delivery freshness.",
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-stale-hook",
    projectId: "demo-project",
    stage: "write",
    stageAfter: "write",
    fromRole: "reviewer",
    toRole: "academic_writer",
    reason: "stage_owner_change",
    payload: {
      hookGatePoint: "before_handoff_delivery",
      hookGateFingerprint: "sha1:stale",
      hookGateVerdict: "pass",
      hookGateStatus: "passed",
      hookGatePolicyIds: ["delivery-gate"],
    },
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        throw new Error("should not dispatch stale hook-gated handoff");
      },
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.terminal, true);
  assert.equal(result.reason, "hook_gate_stale");
  assert.equal(result.intent.status, "superseded");
});

test("deliverWorkflowHandoffIntent escalates when all automatic delivery channels fail", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-human-escalation",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime", "channel_broadcast", "runtime_queue", "human_escalation"],
      maxAttemptsTotal: 5,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return { ok: false, error: "runtime unavailable" };
      },
      async channelBroadcast() {
        return { ok: false, error: "broadcast unavailable" };
      },
      async runtimeQueue() {
        return { ok: false, error: "queue unavailable" };
      },
    },
  });

  assert.equal(result.terminal, true);
  assert.equal(result.intent.status, "escalated");
  assert.equal(result.intent.terminalReason, "human_escalation");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts.at(-1).channel, "human_escalation");
});

test("deliverWorkflowHandoffIntent supersedes stale intents when the channel binding moved to another project", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-binding-"));
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const reboundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const sessionKey = "agent:researcher:discord:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(staleProjectRoot, { recursive: true });
  await fs.mkdir(reboundProjectRoot, { recursive: true });
  await fs.writeFile(
    path.join(staleProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "generalized-category-discovery" }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(reboundProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "gcd-survey-tpami-2026" }, null, 2)}\n`,
    "utf8"
  );

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: reboundProjectRoot,
    boundByAgent: "researcher",
  });

  const created = await upsertWorkflowHandoffIntent({
    projectRoot: staleProjectRoot,
    idempotencyKey: "deliver-stale-binding",
    toRole: "coder",
    fromSessionKey: sessionKey,
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    bindingPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    runtime: {
      async nativeDispatch() {
        throw new Error("should not dispatch");
      },
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.terminal, true);
  assert.equal(result.intent.status, "superseded");
  const store = await readWorkflowHandoffIntentStore(staleProjectRoot);
  assert.equal(store.intents[0].status, "superseded");
});
