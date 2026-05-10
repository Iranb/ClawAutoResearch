import test from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_POLICIES,
  canRoleContact,
  canRoleContactInWorkflow,
  canRoleSpawn,
  canRoleSpawnInWorkflow,
  getForwardStageHandoffTargetRole,
  inferTargetRoleFromToolParams,
  normalizeWorkflowRole,
} from "../../../tools/workflow-guard-policies/role-policy.ts";

test("role policy exports retain the workflow role table and normalization rules", () => {
  assert.equal(ROLE_POLICIES.researcher.allowedContacts.includes("coder"), true);
  assert.equal(ROLE_POLICIES["cross-reviewer"].allowedContacts.length, 0);
  assert.equal(normalizeWorkflowRole("academic-writer"), "academic_writer");
  assert.equal(normalizeWorkflowRole("cross reviewer"), "cross-reviewer");
  assert.equal(inferTargetRoleFromToolParams({ label: "reviewer" }), "reviewer");
});

test("role policy contact and spawn rules allow forward stage handoff only when the stage owner matches", () => {
  assert.equal(canRoleContact("researcher", "coder"), true);
  assert.equal(canRoleSpawn("researcher", "coder"), true);
  assert.equal(canRoleContact("orchestrator", "coder"), false);
  assert.equal(canRoleSpawn("orchestrator", "coder"), false);
  assert.equal(
    canRoleContactInWorkflow({
      fromRole: "orchestrator",
      toRole: "coder",
      currentStage: "plan",
    }),
    true
  );
  assert.equal(
    canRoleSpawnInWorkflow({
      fromRole: "reviewer",
      toRole: "academic_writer",
      currentStage: "review",
    }),
    true
  );
  assert.equal(getForwardStageHandoffTargetRole("plan"), "coder");
});

