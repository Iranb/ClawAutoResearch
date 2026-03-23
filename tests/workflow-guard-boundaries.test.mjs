import test from "node:test";
import assert from "node:assert/strict";

import { shouldBlockCoderDatasetMutation } from "../tools/workflow-guard.ts";

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
