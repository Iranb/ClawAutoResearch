import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeZoteroSyncPacket,
  resolveEffectiveZoteroProjectPath,
} from "../tools/workflow-zotero-sync.ts";

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
  const mod = await import("../tools/workflow-zotero-sync");
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
