import test from "node:test";
import assert from "node:assert/strict";

import {
  canRoleContactInWorkflow,
  canRoleSpawnInWorkflow,
  normalizeWorkflowChannelMentions,
  shouldBlockPapernexusLiveGraphCliRead,
  shouldBlockPapernexusLocalStorageUsage,
  shouldBlockPapernexusLongWaitImportCommand,
  shouldBlockPapernexusLocalGraphProcessing,
  shouldBlockPapernexusMultiPaperImport,
  shouldBlockPapernexusRawHttpUsage,
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

test("papernexus raw-http guard blocks handwritten curl requests to typed PaperNexus endpoints", () => {
  const result = shouldBlockPapernexusRawHttpUsage({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "curl -sS -X POST https://papernexus.example/api/query -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN' --data '{\"name\":\"demo\",\"query\":\"topic\"}'",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /python wrappers|route-shape/i);
});

test("papernexus raw-http guard allows wrapper-based graph commands", () => {
  const result = shouldBlockPapernexusRawHttpUsage({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        'python3 scripts/pn_graph_query.py --api-base "https://papernexus.example" --corpus "demo" query "topic" --limit 8',
    },
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
    assert.match(result.reason ?? "", /python wrappers|live shared graph/i);
  }
});

test("papernexus local graph-processing guard blocks local analyze/build commands when remote PaperNexus is configured", () => {
  for (const command of [
    "papernexus analyze /tmp/papers --name demo-project",
    "papernexus build-graph --name demo-project",
    "node src/cli/index.js watch /tmp/papers --name demo-project",
  ]) {
    const result = shouldBlockPapernexusLocalGraphProcessing({
      role: "researcher",
      toolName: "bash",
      toolParams: {
        command,
      },
      remoteApiBaseUrl: "https://papernexus.example/api",
    });

    assert.equal(result.block, true);
    assert.match(result.reason ?? "", /remote PaperNexus|authenticated/i);
  }
});

test("papernexus local storage guard blocks bash commands that depend on ~/.papernexus storage in remote-only mode", () => {
  const result = shouldBlockPapernexusLocalStorageUsage({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command: "ls ~/.papernexus/papers/gcd-part-manifold-2026/md && echo $PAPERNEXUS_ROOT",
    },
    remoteApiBaseUrl: "https://papernexus.example/api",
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /remote-only|project-local staging|~\/\.papernexus/i);
});

test("papernexus local storage guard blocks direct reads from ~/.papernexus storage in remote-only mode", () => {
  const result = shouldBlockPapernexusLocalStorageUsage({
    role: "analyzer",
    toolName: "read",
    toolParams: {
      path: "/Users/demo/.papernexus/index-store/.papernexus/meta.json",
    },
    remoteApiBaseUrl: "https://papernexus.example/api",
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /remote-only|shared storage/i);
});

test("papernexus local storage guard allows project-local staging files in remote-only mode", () => {
  const result = shouldBlockPapernexusLocalStorageUsage({
    role: "researcher",
    toolName: "read",
    toolParams: {
      path: "/tmp/demo-project/researcher/paper-staging/2502.00032.md",
    },
    remoteApiBaseUrl: "https://papernexus.example/api",
  });

  assert.equal(result.block, false);
});

test("workflow channel mention normalization preserves one raw handoff mention and sanitizes duplicates", () => {
  const normalized = normalizeWorkflowChannelMentions(
    "[STATUS] review complete\n[HANDOFF] next owner: @Reviewer\n[ARTIFACTS] REVIEW_PACKET.md\n[NEXT] /write-paper\n@Reviewer please take it from here."
  );

  assert.match(normalized, /\[HANDOFF\] next owner: @Reviewer/);
  assert.match(normalized, /\n\[reviewer\] please take it from here\./i);
});

test("workflow contact rules allow direct forward handoff to the next stage owner", () => {
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
});

test("papernexus import guard blocks multi-paper queued imports in one request", () => {
  const result = shouldBlockPapernexusMultiPaperImport({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "curl -sS --max-time 30 -X POST https://papernexus.example/api/imports?name=shared-global-graph -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN' --data '{\"files\":[{\"name\":\"a.pdf\",\"contentBase64\":\"aaa\"},{\"name\":\"b.pdf\",\"contentBase64\":\"bbb\"}]}'",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /one paper per import|single-paper/i);
});

test("papernexus import wait guard blocks long polling loops around remote imports", () => {
  const result = shouldBlockPapernexusLongWaitImportCommand({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "for i in 1 2 3 4 5; do curl -sS --max-time 30 https://papernexus.example/api/imports/imp-42?name=shared-global-graph -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'; sleep 15; done",
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /60s|move on|next paper/i);
});

test("papernexus import wait guard allows a single-paper bounded remote import request", () => {
  const result = shouldBlockPapernexusLongWaitImportCommand({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        "curl -sS --max-time 30 -X POST https://papernexus.example/api/imports?name=shared-global-graph -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN' --data '{\"files\":[{\"name\":\"single.pdf\",\"contentBase64\":\"aaa\"}]}'",
    },
  });

  assert.equal(result.block, false);
});

test("papernexus import wait guard blocks wrapper queue waits above 60 seconds", () => {
  const result = shouldBlockPapernexusLongWaitImportCommand({
    role: "researcher",
    toolName: "bash",
    toolParams: {
      command:
        'python3 scripts/pn_import_queue.py --api-base "https://papernexus.example" --corpus "demo" wait "imp-42" --timeout 1800 --interval 2',
    },
  });

  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /60s|60s or less|60s budget|60s or less/i);
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
