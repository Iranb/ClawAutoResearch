import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildFileAuditPrompt,
  materializeFileAuditPacket,
  parseFileAuditResult,
} from "../../../tools/workflow-hooks/file-audit-runner.ts";
import { buildWorkflowHookPointContext } from "../../../tools/workflow-hooks/point-context.ts";
import {
  dispatchAggregateHookRevision,
  getAggregateRevisionPacketPath,
} from "../../../tools/workflow-hooks/revision-dispatch.ts";

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

test("materializeFileAuditPacket prefers writing_session section draft paths over canonical paths", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-audit-section-target-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper", "sections"), {
    recursive: true,
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "alternate"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "alternate", "custom-abstract.tex"),
    "Resolved abstract body.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        writing_session: {
          current_section: "abstract",
          section_packets: {
            abstract: {
              status: "drafting",
              draft_path: "academic_writer/alternate/custom-abstract.tex",
            },
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const policy = {
    hookId: "abstract-hook",
    hookType: "file_audit",
    enabled: true,
    stage: "write",
    hookPoint: "before_task_complete",
    order: 100,
    parallelGroup: null,
    targetRole: "academic_writer",
    auditorRole: "reviewer",
    filePath: "academic_writer/paper/sections/abstract.tex",
    requirementPrompt: "Check the abstract.",
    supportingArtifacts: [],
    blockingMode: "block_stage",
    maxRounds: 3,
    maxUnchangedRounds: 2,
    reviseOwnerRole: "academic_writer",
    reviseCommand: "Revise and rerun.",
    reportDir: "reviewer/file-audits/abstract-hook",
    filters: null,
    appliesWhen: null,
    stateScope: "shared_by_transition",
  };
  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "write",
    hookPoint: "before_task_complete",
    ownerRole: "academic_writer",
    actorRole: "academic_writer",
    targetRole: "academic_writer",
    taskId: "write.section.abstract",
  });

  const packet = await materializeFileAuditPacket({
    projectRoot,
    projectId: "demo-project",
    policy,
    context,
    roundNumber: 1,
  });

  const packetJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, packet.packetJsonPath), "utf8")
  );
  assert.equal(packetJson.filePath, "academic_writer/alternate/custom-abstract.tex");
  assert.equal(packetJson.canonicalFilePath, "academic_writer/paper/sections/abstract.tex");
  assert.equal(packetJson.resolutionSource, "section_packet_draft");
});

test("dispatchAggregateHookRevision writes per-target aggregate packets", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-audit-dispatch-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project", current_stage: "review" }, null, 2)}\n`,
    "utf8"
  );

  const executions = [
    {
      policy: {
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
        supportingArtifacts: [],
        blockingMode: "block_stage",
        maxRounds: 3,
        maxUnchangedRounds: 2,
        reviseOwnerRole: "academic_writer",
        reviseCommand: "Revise writer draft.",
        reportDir: "reviewer/file-audits/writer-main-tex",
      },
      execution: {
        hookId: "writer-main-tex",
        hookPoint: "before_stage_handoff",
        stage: "review",
        verdict: "revise",
        status: "revise_requested",
        pending: false,
        launched: false,
        revisedRequested: true,
        escalated: false,
        fileFingerprint: "sha1:writer",
        result: {
          verdict: "revise",
          summary: "Writer draft needs revision.",
          violations: [],
          requiredFixes: ["Tighten the claim wording."],
          reviewedArtifacts: ["academic_writer/paper/main.tex"],
          confidence: 0.8,
          runId: "run-writer",
          rawText: "{}",
          reviewerRole: "reviewer",
          filePath: "academic_writer/paper/main.tex",
          fileFingerprint: "sha1:writer",
          packetFingerprint: "sha1:packet-writer",
          createdAt: new Date().toISOString(),
        },
        revisionDispatch: null,
        blockingReason: "Writer draft needs revision.",
      },
    },
    {
      policy: {
        hookId: "coder-plan",
        hookType: "file_audit",
        enabled: true,
        stage: "review",
        hookPoint: "before_stage_handoff",
        order: 100,
        parallelGroup: null,
        targetRole: "coder",
        auditorRole: "reviewer",
        filePath: "coder/PLAN.md",
        requirementPrompt: "Check experiment plan.",
        supportingArtifacts: [],
        blockingMode: "block_stage",
        maxRounds: 3,
        maxUnchangedRounds: 2,
        reviseOwnerRole: "coder",
        reviseCommand: "Revise coder plan.",
        reportDir: "reviewer/file-audits/coder-plan",
      },
      execution: {
        hookId: "coder-plan",
        hookPoint: "before_stage_handoff",
        stage: "review",
        verdict: "revise",
        status: "revise_requested",
        pending: false,
        launched: false,
        revisedRequested: true,
        escalated: false,
        fileFingerprint: "sha1:coder",
        result: {
          verdict: "revise",
          summary: "Coder plan needs revision.",
          violations: [],
          requiredFixes: ["Split the experiment into two steps."],
          reviewedArtifacts: ["coder/PLAN.md"],
          confidence: 0.8,
          runId: "run-coder",
          rawText: "{}",
          reviewerRole: "reviewer",
          filePath: "coder/PLAN.md",
          fileFingerprint: "sha1:coder",
          packetFingerprint: "sha1:packet-coder",
          createdAt: new Date().toISOString(),
        },
        revisionDispatch: null,
        blockingReason: "Coder plan needs revision.",
      },
    },
  ];

  const calls = [];
  const results = await dispatchAggregateHookRevision({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: `run-${calls.length}` };
      },
    },
    requesterSessionKey: "agent:researcher:main",
    requesterChannel: "discord",
    projectRoot,
    projectId: "demo-project",
    stage: "review",
    hookPoint: "before_stage_handoff",
    executions,
  });

  assert.equal(results.length, 2);
  const writerPacket = path.join(
    projectRoot,
    getAggregateRevisionPacketPath({
      hookPoint: "before_stage_handoff",
      stage: "review",
      targetRole: "academic_writer",
    })
  );
  const coderPacket = path.join(
    projectRoot,
    getAggregateRevisionPacketPath({
      hookPoint: "before_stage_handoff",
      stage: "review",
      targetRole: "coder",
    })
  );
  const writerText = await fs.readFile(writerPacket, "utf8");
  const coderText = await fs.readFile(coderPacket, "utf8");
  assert.match(writerText, /writer-main-tex/);
  assert.doesNotMatch(writerText, /coder-plan/);
  assert.match(coderText, /coder-plan/);
  assert.doesNotMatch(coderText, /writer-main-tex/);
});
