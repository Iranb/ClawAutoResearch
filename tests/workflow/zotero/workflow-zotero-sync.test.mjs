import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deriveAutoZoteroSyncCandidate,
  materializeZoteroSyncPacket,
  readZoteroSyncStateSummary,
  resolveEffectiveZoteroProjectPath,
} from "../../../tools/workflow-zotero-sync.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-zotero-sync-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "paper-lab",
    graph_last_built_at: "2026-04-09T10:00:00.000Z",
    research_program: {
      baseline_reference: "Baseline Paper",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:1111.1111",
        title: "Baseline Paper",
        arxiv_id: "1111.1111",
      },
      {
        canonical_id: "arxiv:2222.2222",
        title: "Followup Paper",
        arxiv_id: "2222.2222",
      },
    ],
  });
  return projectRoot;
}

test("resolveEffectiveZoteroProjectPath prefers explicit manifest path over global root", () => {
  assert.equal(
    resolveEffectiveZoteroProjectPath({
      projectId: "paper-lab",
      explicitProjectPath: "Bot/custom-folder",
      zoteroProjectRoot: "bot",
    }),
    "Bot/custom-folder"
  );
});

test("resolveEffectiveZoteroProjectPath falls back to the configured global root", () => {
  assert.equal(
    resolveEffectiveZoteroProjectPath({
      projectId: "paper-lab",
      explicitProjectPath: null,
      zoteroProjectRoot: "Bot",
    }),
    "Bot/paper-lab"
  );
});

test("workflow-zotero-sync extensionless shim re-exports the helper APIs", async () => {
  const mod = await import("../../../tools/workflow-zotero-sync");
  assert.equal(typeof mod.materializeZoteroSyncPacket, "function");
  assert.equal(typeof mod.resolveEffectiveZoteroProjectPath, "function");
});

test("materializeZoteroSyncPacket writes selected baselines and writing-shortlist targets", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const packet = await materializeZoteroSyncPacket({
    projectRoot,
    projectId: "paper-lab",
    explicitProjectPath: null,
    zoteroProjectRoot: "Bot",
    trigger: "manual_command",
  });

  assert.equal(packet.zoteroProjectPath, "Bot/paper-lab");
  assert.deepEqual(packet.collections.map((entry) => entry.kind), [
    "selected",
    "baselines",
    "writing-shortlist",
  ]);
  assert.equal(packet.collections[0].canonicalIds.length, 2);
  assert.equal(packet.collections[1].canonicalIds[0], "arxiv:1111.1111");
  assert.equal(packet.removalPolicy, "remove_from_project_collections_only");

  const packetOnDisk = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ZOTERO_SYNC_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(packetOnDisk.zotero_project_path, "Bot/paper-lab");

  const markdown = await fs.readFile(
    path.join(projectRoot, "researcher", "ZOTERO_PACKET.md"),
    "utf8"
  );
  assert.match(markdown, /Bot\/paper-lab/);
  assert.match(markdown, /selected/i);
  assert.match(markdown, /baselines/i);
  assert.match(markdown, /writing-shortlist/i);
});

test("materializeZoteroSyncPacket records collection-only removal policy without deleting Zotero items", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const packet = await materializeZoteroSyncPacket({
    projectRoot,
    projectId: "paper-lab",
    explicitProjectPath: "Bot/paper-lab",
    zoteroProjectRoot: "bot",
    trigger: "graph_build",
  });

  assert.equal(packet.removalPolicy, "remove_from_project_collections_only");
  assert.equal(packet.deleteMissingItems, false);
  assert.equal(packet.trashMissingItems, false);
});

test("materializeZoteroSyncPacket persists trigger reason and collection fingerprint metadata", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    summary: {
      activeExperimentIds: ["exp-1"],
    },
  });

  const packet = await materializeZoteroSyncPacket({
    projectRoot,
    projectId: "paper-lab",
    zoteroProjectRoot: "Bot",
    trigger: "auto_experiment_launch",
    triggerReason: "Experiment activity started for exp-1.",
  });

  assert.equal(packet.trigger, "auto_experiment_launch");
  assert.equal(packet.triggerReason, "Experiment activity started for exp-1.");
  assert.ok(packet.collectionFingerprint);
  assert.equal(packet.graphLastBuiltAtSeen, "2026-04-09T10:00:00.000Z");
  assert.deepEqual(packet.activeExperimentIdsSeen, ["exp-1"]);
  assert.ok(packet.activeExperimentFingerprintSeen);

  const summary = await readZoteroSyncStateSummary({
    projectRoot,
    projectId: "paper-lab",
    zoteroProjectRoot: "Bot",
  });
  assert.equal(summary.status, "pending");
  assert.equal(summary.trigger, "auto_experiment_launch");
  assert.equal(summary.triggerReason, "Experiment activity started for exp-1.");
  assert.equal(summary.collectionFingerprint, packet.collectionFingerprint);
});

test("deriveAutoZoteroSyncCandidate recommends a graph-refresh sync when the graph changed since the last packet", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const candidate = await deriveAutoZoteroSyncCandidate({
    projectRoot,
    projectId: "paper-lab",
    zoteroProjectRoot: "Bot",
  });

  assert.equal(candidate.shouldLaunch, true);
  assert.equal(candidate.trigger, "auto_graph_refresh");
  assert.match(candidate.triggerReason ?? "", /Graph refresh observed/i);
  assert.ok(candidate.dedupeKey);
});

test("deriveAutoZoteroSyncCandidate recommends experiment-start sync when active experiments changed", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeZoteroSyncPacket({
    projectRoot,
    projectId: "paper-lab",
    zoteroProjectRoot: "Bot",
    trigger: "graph_build",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "paper-lab",
    graph_last_built_at: "2026-04-09T10:00:00.000Z",
    research_program: {
      baseline_reference: "Baseline Paper",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    summary: {
      activeExperimentIds: ["exp-2", "exp-3"],
    },
  });

  const candidate = await deriveAutoZoteroSyncCandidate({
    projectRoot,
    projectId: "paper-lab",
    zoteroProjectRoot: "Bot",
  });

  assert.equal(candidate.shouldLaunch, true);
  assert.equal(candidate.trigger, "auto_experiment_launch");
  assert.match(candidate.triggerReason ?? "", /exp-2, exp-3/);
});
