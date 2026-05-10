import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hasActiveLiteratureDiscoveryRequest,
  queueLiteratureDiscoveryRequisition,
  shouldRouteLiteratureDiscoveryToGraphBuild,
} from "../../tools/literature-discovery/workflow-bridge.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("graph-ready dormant literature discovery requests still keep workflow-owned graph reentry active", () => {
  const paperIngestion = {
    queued_requests: [
      {
        request_id: "review-gap-1",
        status: "queued",
        trigger_kind: "review_literature_discovery",
        attempt_count: 0,
      },
    ],
  };

  assert.equal(
    hasActiveLiteratureDiscoveryRequest({
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    true,
  );
  assert.equal(
    shouldRouteLiteratureDiscoveryToGraphBuild({
      currentStage: "review",
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    true,
  );
  assert.equal(
    shouldRouteLiteratureDiscoveryToGraphBuild({
      currentStage: "graph_build",
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    false,
  );
});

test("literature discovery requisition writes PaperNexus-native run-handle contract fields", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-literature-discovery-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "literature-discovery-native",
  });
  await writeJson(path.join(projectRoot, "researcher", "DISCOVERY_PACKET.json"), {
    discovery_id: "gap-1",
    discovery_reason: "Need graph-backed evidence for missing baselines.",
    target_domains: ["baselines"],
    candidate_queries: [
      {
        domain: "baselines",
        query: "graph reasoning benchmark baseline",
      },
    ],
  });

  const queued = await queueLiteratureDiscoveryRequisition({
    projectRoot,
    packetPath: "researcher/DISCOVERY_PACKET.json",
    originStage: "review",
  });

  assert.equal(queued.created, true);
  const requisition = JSON.parse(
    await fs.readFile(path.join(projectRoot, queued.batchManifestPath), "utf8")
  );
  assert.equal(requisition.controller, "papernexus");
  assert.equal(requisition.operation, "literature_discovery_import");
  assert.equal(requisition.refresh_policy, "reuse_existing_handle");
  assert.deepEqual(requisition.run_handle.task_ids, []);
  assert.equal(requisition.fallback.allow_metadata_supported_survey, true);
  assert.equal(requisition.fallback.allow_degraded_graph_continue, true);
  assert.equal(requisition.papernexus_literature_discovery.operation, "ingest");
  assert.equal(requisition.papernexus_literature_discovery.async_fallback_operation, "import");
  assert.equal(requisition.papernexus_literature_discovery.supplement_operation, "supplement");
  assert.equal(requisition.papernexus_literature_discovery.prefer_markdown, true);
  assert.equal(
    requisition.papernexus_literature_discovery.generate_arxiv_markdown_sources,
    true
  );
  assert.equal(
    requisition.papernexus_literature_discovery.preserve_metadata_graph,
    true
  );
  assert.equal(
    requisition.papernexus_literature_discovery.preserve_metadata_only_candidates,
    true
  );
  assert.equal(
    requisition.papernexus_literature_discovery.supplementation.reserved_operation,
    "supplement"
  );
  assert.equal(requisition.literature_discovery.discovery_id, "gap-1");
  assert.match(queued.request.commandText, /PaperNexus-native literature discovery/i);
  assert.match(queued.request.commandText, /operation: ingest/i);
  assert.match(queued.request.commandText, /operation: supplement/i);
  assert.match(queued.request.commandText, /metadataGraph/i);
  assert.match(queued.request.commandText, /preferMarkdown=true/i);
});
