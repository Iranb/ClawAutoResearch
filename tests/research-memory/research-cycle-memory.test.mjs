import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_ESE_CYCLE_MEMORY_PATH,
  DEFAULT_IDE_CYCLE_MEMORY_PATH,
  DEFAULT_IVE_CYCLE_MEMORY_PATH,
  materializeCycleMemory,
} from "../../tools/research-memory-cycle.ts";

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeCycleMemoryProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-cycle-memory-")
  );

  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"), {
    surviving_direction: "graph-grounded support router",
    failed_directions: ["generic prose-only polishing"],
  });
  await writeText(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "# Innovation Reflection\n- Keep graph-grounded support routing.\n- Avoid prose-only framing.\n"
  );
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        hypothesis: "Graph-grounded routing improves support precision.",
        novelty_basis: "Use graph packets as a routing layer.",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"), {
    top_fragments: [
      {
        fragment_id: "frag-1",
        title: "Graph-grounded support router",
        mapped_claims: [{ claim_id: "claim-1", claim: "Improve support precision." }],
      },
    ],
  });
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "# Claim Evidence Matrix\n- claim-1 supported by Table 1\n- claim-2 partial because clarity evidence is sparse\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"),
    "# Review Report\n- novelty is plausible but needs a narrower scope\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "rebuttal_2026-04-05.md"),
    "# Rebuttal\n- Strategy: downgrade_claim for claim-2\n- Strategy: rebut_with_existing_evidence for claim-1\n"
  );
  await writeText(
    path.join(projectRoot, "memory", "experiment-memory.md"),
    "# Experiment Memory\n- Keep the router-only ablation because it isolates the real gain.\n"
  );

  return projectRoot;
}

test("cycle memory aggregates ideation, validation, and reviewer-learning artifacts into IDE/IVE/ESE packets", async (t) => {
  const projectRoot = await makeCycleMemoryProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await materializeCycleMemory({
    projectRoot,
    stage: "write",
  });

  assert.equal(result.ide.status, "ready");
  assert.ok(result.ide.transferablePatterns.some((entry) => /graph-grounded/i.test(entry)));
  assert.ok(result.ive.claimSupportFindings.some((entry) => /partial|supported/i.test(entry)));
  assert.ok(
    result.ese.rebuttalStrategies.some((entry) =>
      /downgrade_claim|rebut_with_existing_evidence/i.test(entry)
    )
  );

  const ideMemory = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_IDE_CYCLE_MEMORY_PATH), "utf8")
  );
  const iveMemory = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_IVE_CYCLE_MEMORY_PATH), "utf8")
  );
  const eseMemory = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_ESE_CYCLE_MEMORY_PATH), "utf8")
  );

  assert.equal(ideMemory.status, "ready");
  assert.equal(iveMemory.status, "ready");
  assert.equal(eseMemory.status, "ready");
});
