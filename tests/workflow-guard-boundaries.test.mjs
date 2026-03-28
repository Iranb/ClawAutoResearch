import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldBlockPapernexusLiveGraphCliRead,
  shouldBlockPapernexusInlineExecution,
  shouldBlockPapernexusDestructiveOperation,
  shouldBlockCoderDatasetMutation,
  shouldBlockResearchGraphForce,
} from "../tools/workflow-guard.ts";

test("coder dataset guard blocks in-place dataset mutations via bash", () => {
  const result = shouldBlockCoderDatasetMutation({
    role: "coder",
    projectRoot: "/tmp/demo-project",
    toolName: "bash",
    toolParams: {
      command: 'ssh gpu-server "rm -rf /data/datasets/coco/cache"',
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /read-only/i);
});

test("coder dataset guard allows read-only dataset references in bash", () => {
  const result = shouldBlockCoderDatasetMutation({
    role: "coder",
    projectRoot: "/tmp/demo-project",
    toolName: "bash",
    toolParams: {
      command:
        'ssh gpu-server "CUDA_VISIBLE_DEVICES=0 uv run python train.py --data_dir /data/datasets/coco --output_dir /tmp/run-1"',
    },
  });

  assert.equal(result.block, false);
});

test("coder dataset guard blocks direct edits to dataset files", () => {
  const result = shouldBlockCoderDatasetMutation({
    role: "coder",
    projectRoot: "/tmp/demo-project",
    toolName: "edit",
    toolParams: {
      path: "/data/projects/demo-project/datasets/labels/train.json",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /dataset/i);
});

test("researcher graph guard blocks slash-style graph-build --force during literature graph stages", () => {
  const result = shouldBlockResearchGraphForce({
    role: "researcher",
    currentStage: "graph_build",
    toolName: "sessions_send",
    toolParams: {
      message: "/graph-build --force",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /do not use --force/i);
});

test("researcher graph guard blocks papernexus analyze --force during frontier mapping", () => {
  const result = shouldBlockResearchGraphForce({
    role: "researcher",
    currentStage: "frontier_mapping",
    toolName: "bash",
    toolParams: {
      command: "papernexus analyze /tmp/papers --name demo-project --force",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /cache-first/i);
});

test("researcher graph guard allows non-force graph refresh commands", () => {
  const result = shouldBlockResearchGraphForce({
    role: "researcher",
    currentStage: "idea",
    toolName: "bash",
    toolParams: {
      command: "papernexus analyze /tmp/papers --name demo-project",
    },
  });

  assert.equal(result.block, false);
});

test("foreground papernexus inline guard blocks researcher bash execution outside subagent sessions", () => {
  const result = shouldBlockPapernexusInlineExecution({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command: 'papernexus query "multimodal adaptation"',
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /dedicated subagent/i);
});

test("foreground papernexus inline guard allows authenticated PaperNexus API execution inside subagent sessions", () => {
  const result = shouldBlockPapernexusInlineExecution({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "curl -X POST https://papernexus.example/api/query -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
    },
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:query",
  });

  assert.equal(result.block, false);
});

test("papernexus live-graph cli read guard blocks local query commands even inside subagent sessions", () => {
  for (const command of [
    'papernexus query "multimodal adaptation"',
    'papernexus brainstorm "multimodal adaptation"',
    'src/cli/index.js evidence-chain "multimodal adaptation"',
    'src/cli/index.js research-brief "multimodal adaptation"',
  ]) {
    const result = shouldBlockPapernexusLiveGraphCliRead({
      role: "researcher",
      toolName: "bash",
      toolParams: {
        command,
      },
    });

    assert.equal(result.block, true);
    assert.match(result.reason ?? "", /authenticated http api|live graph/i);
  }
});

test("papernexus destructive guard blocks backup and restore commands during normal agent operation", () => {
  const result = shouldBlockPapernexusDestructiveOperation({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command: "papernexus backup-load /tmp/papernexus-backup.tgz --name shared-global-graph",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /backup|restore/i);
});

test("papernexus destructive guard blocks removing shared graph storage from bash", () => {
  const result = shouldBlockPapernexusDestructiveOperation({
    role: "analyzer",
    toolName: "bash",
    toolParams: {
      command: "rm -rf ~/.papernexus/index-store ~/.papernexus/papers",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /delete|shared graph|corpus/i);
});

test("foreground papernexus inline guard treats remote import api calls as heavy work", () => {
  const result = shouldBlockPapernexusInlineExecution({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "curl -X POST https://papernexus.example/api/imports?name=shared-global-graph -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /dedicated subagent/i);
});

test("foreground papernexus inline guard treats remote typed brief and chain APIs as heavy work", () => {
  for (const command of [
    "curl -X POST https://papernexus.example/api/brainstorm-brief -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
    "curl -X POST https://papernexus.example/api/evidence-chain -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
    "curl -X POST https://papernexus.example/api/path-trace -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
  ]) {
    const result = shouldBlockPapernexusInlineExecution({
      role: "researcher",
      toolName: "bash",
      toolParams: {
        command,
      },
      sessionKey: "agent:researcher:discord:group:paper-lab",
    });
    assert.equal(result.block, true);
    assert.match(result.reason ?? "", /dedicated subagent/i);
  }
});
