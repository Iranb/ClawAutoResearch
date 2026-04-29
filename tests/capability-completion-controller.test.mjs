import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeCapabilityCompletionControllerArtifacts,
} from "../tools/capability-completion/controller.ts";
import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const plugin = createPluginRegistrationContext({
    runtime: params.runtime ?? {},
    logger: params.logger ?? {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  });
  registerWorkflowTools(plugin);
  assert.ok(registeredTool);
  return registeredTool({
    workspaceDir: params.workspaceDir,
    agentId: params.agentId ?? "researcher",
    sessionKey: params.sessionKey ?? "agent:researcher:test",
    sessionId: params.sessionId ?? "session-test",
    messageChannel: params.messageChannel ?? "local",
    channelKey: params.channelKey,
  });
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

test("capability completion controller materializes gap inventory and execution plan", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-capability-controller-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "capability-demo",
    current_stage: "submit",
    owner_agent: "academic_writer",
    research_program: {
      goal: "Improve generalized category discovery with FixMatch-style consistency regularization",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "E2E_RUN_SCORECARD.json"), {
    verdict: {
      final_verdict: "partial",
      claim_strength_cap: "partial",
    },
    literature_research_controller: {
      status: "needs_research",
      decision: "continue_research",
      coverage_score_100: 52,
    },
    papernexus_certification: {
      status: "partial",
      claim_level: "remote_corpus_summary",
      source_backed_graph_claim: false,
    },
    benchmark_adapter: { status: "missing" },
    domain_evaluator: { status: "partial" },
    reviewer_calibration: { status: "partial" },
    copyedit_style_audit: { status: "partial" },
    failed_required_checks: [
      { group: "content_substance", name: "paper_word_count", observed: 100, expected: 4000 },
    ],
    diagnostic_failed_checks: [],
  });
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [{ id: "r1", status: "open", severity: "major" }],
  });

  const result = await materializeCapabilityCompletionControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-29T02:00:00.000Z",
    trigger: "unit_test",
    mode: "autoresearch",
  });

  assert.equal(result.project_id, "capability-demo");
  assert.equal(result.status, "planned");
  assert.ok(result.gap_inventory.open_gap_count >= 6);
  assert.ok(result.execution_plan.actions.length >= 6);
  assert.equal(
    result.gap_inventory.gaps.some(
      (gap) => gap.capability === "literature" && gap.status === "runnable"
    ),
    true
  );
  assert.equal(
    result.gap_inventory.gaps.some(
      (gap) => gap.capability === "evidence_chain" && gap.status === "planned"
    ),
    true
  );
  assert.match(
    await fs.readFile(result.artifact_paths.status_markdown_path, "utf8"),
    /Capability Completion Status/
  );
  assert.equal(
    (await readJson(result.artifact_paths.gap_inventory_path)).open_gap_count,
    result.gap_inventory.open_gap_count
  );
  assert.match(
    await fs.readFile(result.artifact_paths.repair_queue_path, "utf8"),
    /literature_controller_needs_research/
  );
});

test("capability completion controller classifies provider auth and rate-limit failures", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-capability-provider-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "capability-provider-demo",
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "E2E_RUN_SCORECARD.json"), {
    verdict: { claim_strength_cap: "partial" },
    literature_research_controller: {
      status: "needs_research",
      decision: "continue_research",
      coverage_score_100: 30,
    },
    failed_required_checks: [],
    diagnostic_failed_checks: [],
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "literature-research-controller",
      "provider_result_index.json"
    ),
    {
      status: "executed",
      provider_query_count: 1,
      provider_names: ["semanticscholar"],
      provider_query_results: [
        {
          provider: "semanticscholar",
          query_id: "q1",
          status: "error",
          error: "401 Unauthorized: API key missing",
        },
      ],
    }
  );

  const authResult = await materializeCapabilityCompletionControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-29T02:10:00.000Z",
    trigger: "auth_test",
    executeRunnableActions: false,
  });
  const authGap = authResult.gap_inventory.gaps.find(
    (gap) => gap.code === "literature_controller_needs_research"
  );
  assert.equal(authResult.status, "blocked");
  assert.equal(authGap?.blocked_by_auth, true);
  assert.equal(authGap?.status, "blocked");

  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "literature-research-controller",
      "provider_result_index.json"
    ),
    {
      status: "executed",
      provider_query_count: 1,
      provider_names: ["semanticscholar"],
      provider_query_results: [
        {
          provider: "semanticscholar",
          query_id: "q1",
          status: "error",
          error: "429 Too Many Requests",
        },
      ],
    }
  );
  const rateLimitResult = await materializeCapabilityCompletionControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-29T02:20:00.000Z",
    trigger: "rate_limit_test",
    executeRunnableActions: false,
  });
  const rateLimitGap = rateLimitResult.gap_inventory.gaps.find(
    (gap) => gap.code === "literature_controller_needs_research"
  );
  assert.equal(rateLimitGap?.status, "deferred");
  assert.match(rateLimitGap?.deferred_until ?? "", /^2026-04-29T03:20:00\.000Z$/);
  assert.equal(rateLimitResult.provider_cache_manifest.rate_limit_count, 1);
});

test("research_workflow exposes run_capability_completion_controller", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-capability-tool-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "capability-tool-demo",
    current_stage: "review",
    owner_agent: "researcher",
  });
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "run_capability_completion_controller",
    projectRoot,
    capabilityCompletion: {
      trigger: "workflow_tool_unit_test",
      mode: "autoresearch",
      executeRunnableActions: false,
    },
  });

  assert.equal(result.project_id, "capability-tool-demo");
  assert.equal(typeof result.status, "string");
  assert.match(
    result.artifact_paths.status_markdown_path,
    /CAPABILITY_COMPLETION_STATUS\.md$/
  );
});
