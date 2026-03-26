import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldBlockPapernexusInlineExecution,
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

test("foreground papernexus inline guard allows researcher bash execution inside subagent sessions", () => {
  const result = shouldBlockPapernexusInlineExecution({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command: 'papernexus query "multimodal adaptation"',
    },
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:query",
  });

  assert.equal(result.block, false);
});
