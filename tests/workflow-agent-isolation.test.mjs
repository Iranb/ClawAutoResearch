import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES,
  isProjectWorkflowAgentId,
  isWorkflowBindingVisibleToAgent,
  normalizeWorkflowAllowedAgentIds,
  normalizeWorkflowAllowedRoles,
  normalizeWorkflowIsolationMode,
  resolveWorkflowBroadcastSessionKey,
} from "../tools/workflow-agent-isolation.ts";

test("workflow isolation defaults only expose bindings to project workflow agents", () => {
  const binding = {
    workflowIsolationMode: "workflow_roles_only",
    workflowAllowedRoles: DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES,
    workflowAllowedAgentIds: [],
    workflowRole: "researcher",
    workflowSessionKey: "agent:researcher:discord:group:paper-lab",
    sessionKeySample: "agent:designer:discord:group:paper-lab",
  };

  assert.equal(
    isWorkflowBindingVisibleToAgent({
      binding,
      agentId: "researcher",
    }),
    true
  );
  assert.equal(
    isWorkflowBindingVisibleToAgent({
      binding,
      agentId: "designer",
    }),
    false
  );
});

test("resolveWorkflowBroadcastSessionKey prefers workflow-owned session over generic sample", () => {
  const binding = {
    workflowIsolationMode: "workflow_roles_only",
    workflowAllowedRoles: DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES,
    workflowAllowedAgentIds: [],
    workflowRole: "researcher",
    workflowSessionKey: "agent:researcher:discord:group:paper-lab",
    workflowBroadcastSessionKey: "agent:researcher:discord:group:paper-lab:thread:workflow",
    sessionKeySample: "agent:designer:discord:group:paper-lab",
  };

  assert.equal(
    resolveWorkflowBroadcastSessionKey(binding),
    "agent:researcher:discord:group:paper-lab:thread:workflow"
  );
});

test("workflow isolation helpers normalize policy fields conservatively", () => {
  assert.equal(normalizeWorkflowIsolationMode("channel_shared"), "channel_shared");
  assert.equal(normalizeWorkflowIsolationMode("unknown"), "workflow_roles_only");
  assert.deepEqual(normalizeWorkflowAllowedRoles(["Researcher", "writer", "", null]), [
    "researcher",
    "academic_writer",
  ]);
  assert.deepEqual(
    normalizeWorkflowAllowedAgentIds(["Researcher", "designer", "designer", "", null]),
    ["researcher", "designer"]
  );
  assert.equal(isProjectWorkflowAgentId("writer"), true);
  assert.equal(isProjectWorkflowAgentId("designer"), false);
});
