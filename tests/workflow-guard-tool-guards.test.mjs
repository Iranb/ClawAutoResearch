import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldBlockCoderDatasetMutation,
  shouldBlockInnovationWrite,
  shouldBlockPapernexusDestructiveOperation,
  shouldBlockPapernexusInlineExecution,
  shouldBlockPapernexusLocalStorageUsage,
  shouldBlockPapernexusLongWaitImportCommand,
  shouldBlockPapernexusRawHttpUsage,
  shouldBlockProjectWrite,
  shouldBlockResearchGraphForce,
  shouldBlockWriterTemplateWrite,
} from "../tools/workflow-guard-policies/tool-guards.ts";

test("tool guards block dataset mutation, forced graph refresh, and raw PaperNexus HTTP", () => {
  assert.equal(
    shouldBlockCoderDatasetMutation({
      role: "coder",
      projectRoot: "/tmp/demo-project",
      toolName: "bash",
      toolParams: {
        command: 'ssh gpu-server "rm -rf /data/datasets/coco/cache"',
      },
    }).block,
    true
  );
  assert.equal(
    shouldBlockResearchGraphForce({
      role: "researcher",
      currentStage: "graph_build",
      toolName: "sessions_send",
      toolParams: { message: "/graph-build --force" },
    }).block,
    true
  );
  assert.equal(
    shouldBlockPapernexusRawHttpUsage({
      role: "researcher",
      toolName: "bash",
      toolParams: {
        command:
          "curl -sS -X POST https://papernexus.example/api/query -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
      },
    }).block,
    true
  );
});

test("tool guards block remote-only PaperNexus access, destructive storage actions, and long waits", () => {
  assert.equal(
    shouldBlockPapernexusLocalStorageUsage({
      role: "researcher",
      toolName: "read",
      toolParams: { path: "/Users/demo/.papernexus/index-store/.papernexus/meta.json" },
      remoteApiBaseUrl: "https://papernexus.example/api",
    }).block,
    true
  );
  assert.equal(
    shouldBlockPapernexusDestructiveOperation({
      role: "analyzer",
      toolName: "bash",
      toolParams: { command: "rm -rf ~/.papernexus/index-store ~/.papernexus/papers" },
    }).block,
    true
  );
  assert.equal(
    shouldBlockPapernexusLongWaitImportCommand({
      role: "researcher",
      toolName: "bash",
      toolParams: {
        command:
          'python3 scripts/pn_import_queue.py --api-base "https://papernexus.example" --corpus "demo" wait "imp-42" --timeout 1800 --interval 2',
      },
    }).block,
    true
  );
});

test("tool guards allow normal writes when they stay inside the scoped project", () => {
  assert.equal(
    shouldBlockProjectWrite({
      role: "researcher",
      projectRoot: "/tmp/demo-project",
      toolName: "write",
      toolParams: { path: "researcher/notes.md" },
    }).block,
    false
  );
  assert.equal(
    shouldBlockInnovationWrite({
      projectRoot: "/tmp/demo-project",
      role: "researcher",
      currentStage: "idea",
      innovationReflectionDue: true,
      toolName: "write",
      toolParams: { path: "/tmp/demo-project/researcher/IDEA_REPORT.md" },
    }).block,
    true
  );
  assert.equal(
    shouldBlockWriterTemplateWrite({
      projectRoot: "/tmp/demo-project",
      role: "academic_writer",
      currentStage: "write",
      writingTemplateRequired: true,
      writingTemplateStatus: "missing",
      toolName: "edit",
      toolParams: { path: "/tmp/demo-project/academic_writer/PAPER_PLAN.md" },
    }).block,
    true
  );
  assert.equal(
    shouldBlockPapernexusInlineExecution({
      role: "researcher",
      toolName: "bash",
      toolParams: { command: "papernexus query \"multimodal adaptation\"" },
      sessionKey: "agent:researcher:discord:group:paper-lab",
    }).block,
    true
  );
});

