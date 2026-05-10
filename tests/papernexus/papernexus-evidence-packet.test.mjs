import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPapernexusEvidencePacket,
  materializePapernexusEvidencePacket,
} from "../../tools/papernexus-packets/evidence-packet.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("PaperNexus evidence packet classifies supported, partial, and unsupported claims", () => {
  const packet = buildPapernexusEvidencePacket({
    createdAt: "2026-05-10T00:00:00.000Z",
    input: {
      claims: [
        {
          claim_id: "c1",
          claim_text: "The method improves graph-backed retrieval coverage.",
          source_nodes: [{ node_id: "pn-node-1" }],
          source_artifacts: ["researcher/papernexus/GRAPH_STORYLINE_PACKET.json"],
          citation_keys: ["smith2026graph"],
        },
        {
          claim_id: "c2",
          claim_text: "The benchmark baseline is relevant but not directly compared.",
          source_artifacts: ["researcher/SOTA_MATRIX.md"],
          missing_evidence: ["direct comparison table"],
        },
        {
          claim_id: "c3",
          claim_text: "The system beats all prior work.",
        },
      ],
    },
  });

  assert.equal(packet.summary.supported_claim_count, 1);
  assert.equal(packet.summary.partial_claim_count, 1);
  assert.equal(packet.summary.unsupported_claim_count, 1);
  assert.equal(packet.claims[0].recommended_action, "write");
  assert.equal(packet.claims[1].recommended_action, "weaken");
  assert.equal(packet.claims[2].recommended_action, "defer");
});

test("PaperNexus evidence packet materializer writes JSON, markdown, and manifest summary", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-papernexus-evidence-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "papernexus-evidence",
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "papernexus",
      "PAPERNEXUS_EVIDENCE_INPUT.json"
    ),
    {
      source_artifacts: ["researcher/COVERAGE_SUMMARY.md"],
      claims: [
        {
          claim_id: "claim-gap",
          claim_text: "The survey reveals a graph evidence gap.",
          source_nodes: ["gap-node"],
          source_artifacts: ["researcher/GAP_SYNTHESIS.md"],
        },
        {
          claim_id: "claim-unsupported",
          claim_text: "The paper solves every open issue.",
          missing_evidence: ["source-backed graph node"],
        },
      ],
      baselines: [
        {
          family_name: "DETR-family",
          representative_papers: ["DETR"],
          fairness_boundary: "Comparable only for object detection benchmarks.",
          has_direct_comparison_data: false,
          source_artifacts: ["researcher/SOTA_MATRIX.md"],
        },
      ],
      figure_evidence: [
        {
          figure_id: "fig_taxonomy",
          source_artifacts: ["researcher/LITERATURE_REVIEW.md"],
        },
      ],
    }
  );

  const result = await materializePapernexusEvidencePacket({
    projectRoot,
    createdAt: "2026-05-10T00:00:00.000Z",
  });

  assert.equal(result.packet.status, "ready");
  assert.equal(result.packet.summary.supported_claim_count, 1);
  assert.equal(result.packet.summary.unsupported_claim_count, 1);
  assert.equal(result.generatedFiles.includes("PROJECT_MANIFEST.json"), true);

  const markdown = await fs.readFile(
    path.join(
      projectRoot,
      "researcher",
      "papernexus",
      "PAPERNEXUS_EVIDENCE_PACKET.md"
    ),
    "utf8"
  );
  assert.match(markdown, /Evidence Boundary/i);
  assert.match(markdown, /unsupported/i);
  assert.match(markdown, /DETR-family/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.papernexus_evidence_packet.status, "ready");
  assert.equal(
    manifest.papernexus_evidence_packet.markdown_path,
    "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md"
  );
});
