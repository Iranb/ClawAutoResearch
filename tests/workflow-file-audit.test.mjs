import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildFileAuditPrompt,
  materializeFileAuditPacket,
  parseFileAuditResult,
} from "../tools/workflow-hooks/file-audit-runner.ts";
import { buildWorkflowHookPointContext } from "../tools/workflow-hooks/point-context.ts";

test("materializeFileAuditPacket writes packet artifacts and prompt references them", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-audit-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), {
    recursive: true,
  });
  await fs.mkdir(path.join(projectRoot, "analyzer"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "The main claim is strong.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "- claim-a supported\n",
    "utf8"
  );

  const policy = {
    hookId: "writer-main-tex",
    hookType: "file_audit",
    enabled: true,
    stage: "review",
    hookPoint: "before_stage_handoff",
    order: 100,
    parallelGroup: null,
    targetRole: "academic_writer",
    auditorRole: "reviewer",
    filePath: "academic_writer/paper/main.tex",
    requirementPrompt: "Check unsupported claims.",
    supportingArtifacts: ["analyzer/CLAIM_EVIDENCE_MATRIX.md"],
    blockingMode: "block_stage",
    maxRounds: 3,
    maxUnchangedRounds: 2,
    reviseOwnerRole: "academic_writer",
    reviseCommand: "Revise and rerun.",
    reportDir: "reviewer/file-audits/writer-main-tex",
  };
  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "review",
    hookPoint: "before_stage_handoff",
    ownerRole: "academic_writer",
    actorRole: "researcher",
  });
  const packet = await materializeFileAuditPacket({
    projectRoot,
    projectId: "demo-project",
    policy,
    context,
    roundNumber: 1,
  });

  assert.match(packet.packetPath, /AUDIT_PACKET\.md$/);
  assert.match(packet.packetJsonPath, /AUDIT_PACKET\.json$/);
  assert.match(packet.fileFingerprint ?? "", /^sha1:/);

  const prompt = buildFileAuditPrompt({
    projectRoot,
    projectId: "demo-project",
    policy,
    packetPath: packet.packetPath,
    packetJsonPath: packet.packetJsonPath,
  });
  assert.match(prompt, /AUDIT_PACKET\.md/);
  assert.match(prompt, /Check unsupported claims/);

  const packetJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, packet.packetJsonPath), "utf8")
  );
  assert.equal(packetJson.filePath, "academic_writer/paper/main.tex");
});

test("parseFileAuditResult accepts valid JSON and hard-fails invalid JSON", () => {
  const parsed = parseFileAuditResult({
    rawText: JSON.stringify({
      verdict: "revise",
      summary: "The file contains one unsupported claim.",
      violations: [
        {
          rule: "unsupported_claim",
          severity: "high",
          location: "section 2",
          message: "The claim is missing support.",
        },
      ],
      requiredFixes: ["Delete or soften the unsupported claim."],
      reviewedArtifacts: ["academic_writer/paper/main.tex"],
      confidence: 0.8,
    }),
    reviewerRole: "reviewer",
    filePath: "academic_writer/paper/main.tex",
    fileFingerprint: "sha1:abc",
    runId: "run-1",
  });
  assert.equal(parsed.verdict, "revise");
  assert.equal(parsed.requiredFixes.length, 1);

  const fallback = parseFileAuditResult({
    rawText: "not json",
    reviewerRole: "reviewer",
    filePath: "academic_writer/paper/main.tex",
    fileFingerprint: "sha1:def",
    runId: "run-2",
  });
  assert.equal(fallback.verdict, "block");
  assert.equal(fallback.violations[0]?.rule, "invalid_json");
});
