import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  queueWorkflowMailboxMessageImpl,
} from "../../../tools/workflow-guard-collaboration.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-mailbox-collab-")
  );
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  return projectRoot;
}

async function readJsonIfExists(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonEnsured(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("queueWorkflowMailboxMessageImpl reuses an identical pending message instead of duplicating it", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const baseParams = {
    projectRoot,
    fromAgent: "orchestrator",
    toAgent: "researcher",
    subject: "auto-iterator: idea owner handoff",
    body: [
      "Please resume idea stage.",
      "Next action: Run /idea-phase.",
      "Missing stage signals: active track fd-gcd-freq-debiased missing graph-backed innovation evidence",
    ].join("\n"),
    kind: "handoff",
    priority: "high",
    readJsonIfExists,
    writeJsonEnsured,
  };

  const first = await queueWorkflowMailboxMessageImpl(baseParams);
  const second = await queueWorkflowMailboxMessageImpl(baseParams);

  assert.equal(second.id, first.id);

  const mailbox = await readJsonIfExists(
    path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json")
  );
  assert.equal(mailbox.messages.length, 1);
  assert.equal(mailbox.messages[0].id, first.id);
});
