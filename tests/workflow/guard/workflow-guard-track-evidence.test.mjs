import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadTrackInnovationEvidence,
  resolveTrackInnovationEvidence,
} from "../../../tools/workflow-guard-track-evidence.ts";

test("track evidence resolver treats PaperNexus trace fields as graph-backed support", () => {
  const state = resolveTrackInnovationEvidence({
    track_id: "idea-primary",
    transferred_mechanism: "curriculum relay",
    bridge_path_ids: ["bridge-path-1"],
    evidence_chain_refs: [
      {
        ref_id: "chain-ref-1",
        node_id: "graph-node-1",
      },
    ],
    source_spans: [
      {
        span_id: "span-1",
        snippet_node_id: "snippet-node-1",
        paper_id: "paper-1",
      },
    ],
  });

  assert.equal(state.presence, "inline_only");
  assert.equal(state.hasGraphBackedInnovationEvidence, true);
  assert.equal(state.hasStructuralGraphEvidence, true);
  assert.equal(state.hasStoryFacingTrackGraphSupport, true);
  assert.ok(state.evidencePointers.includes("paper_nexus:bridge_path:bridge-path-1"));
  assert.ok(state.evidencePointers.includes("paper_nexus:evidence_ref:chain-ref-1"));
  assert.ok(state.evidencePointers.includes("paper_nexus:source_span:span-1"));
  assert.ok(state.linkedGraphNodes.includes("graph-node-1"));
  assert.ok(state.linkedGraphNodes.includes("snippet-node-1"));
  assert.ok(
    state.relationPatterns.includes(
      "paper_nexus_transferred_mechanism:curriculum relay"
    )
  );
});

test("track evidence loader imports PaperNexus trace fields from GRAPH_EVIDENCE artifacts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-track-evidence-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const reasoningPacketDir = "researcher/reasoning/idea-primary";
  await fs.mkdir(path.join(projectRoot, reasoningPacketDir), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, reasoningPacketDir, "GRAPH_EVIDENCE.json"),
    JSON.stringify(
      {
        graph_backed_innovation_evidence: {
          transferred_mechanism: "metacontrol arbitration",
          bridge_path_ids: ["bridge-path-2"],
          evidence_chain_refs: [
            {
              ref_id: "chain-ref-2",
              node_id: "graph-node-2",
            },
          ],
          source_spans: [
            {
              span_id: "span-2",
              snippet_node_id: "snippet-node-2",
            },
          ],
        },
      },
      null,
      2
    )
  );

  const state = await loadTrackInnovationEvidence({
    projectRoot,
    track: {
      track_id: "idea-primary",
      reasoning_packet_dir: reasoningPacketDir,
    },
  });

  assert.equal(state.presence, "file_backed");
  assert.equal(state.importedFromGraphEvidence, true);
  assert.ok(state.evidencePointers.includes("paper_nexus:bridge_path:bridge-path-2"));
  assert.ok(state.evidencePointers.includes("paper_nexus:evidence_ref:chain-ref-2"));
  assert.ok(state.evidencePointers.includes("paper_nexus:source_span:span-2"));
  assert.ok(state.linkedGraphNodes.includes("graph-node-2"));
  assert.ok(state.linkedGraphNodes.includes("snippet-node-2"));
  assert.ok(
    state.relationPatterns.includes(
      "paper_nexus_transferred_mechanism:metacontrol arbitration"
    )
  );
});
