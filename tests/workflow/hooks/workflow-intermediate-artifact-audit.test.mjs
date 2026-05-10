import test from "node:test";
import assert from "node:assert/strict";

import {
  auditExperimentLaunchDecisionObject,
  auditFrontierReportText,
  auditIdeaAuditText,
  auditIdeaReportText,
  auditRevisionCycleObject,
  auditTheoryStateObject,
} from "../../../tools/workflow-intermediate-artifact-audit.ts";

test("frontier and idea markdown audits reject hollow heading-only stubs", () => {
  const frontier = auditFrontierReportText("# Frontier\n");
  const idea = auditIdeaReportText("# Idea Report\n");
  const audit = auditIdeaAuditText("# Idea Audit\n");

  assert.equal(frontier.ok, false);
  assert.equal(idea.ok, false);
  assert.equal(audit.ok, false);
});

test("frontier and idea markdown audits accept structured substantive content", () => {
  const frontier = auditFrontierReportText(
    "# Frontier\n- challenge: memory drift\n- insight: uncertainty-aware adaptation\n"
  );
  const idea = auditIdeaReportText(
    "# Idea Report\n- thesis: use graph constraints\n- falsifier: compare without graph constraints\n"
  );

  assert.equal(frontier.ok, true);
  assert.equal(idea.ok, true);
});

test("theory state audit rejects hollow structures and accepts structured proof state", () => {
  const hollow = auditTheoryStateObject({
    status: "draft",
    overall_signal: "green",
    theorem_candidates: [],
    lemma_packets: [],
    appendix_sections: [],
  });
  const structured = auditTheoryStateObject({
    status: "draft",
    overall_signal: "green",
    thesis: "Margin-aware pseudo-labeling reduces assignment error.",
    theorem_candidates: [
      {
        packet_id: "theorem_demo",
        statement: "Demo theorem statement.",
      },
    ],
    lemma_packets: [],
    appendix_sections: [],
  });

  assert.equal(hollow.ok, false);
  assert.equal(structured.ok, true);
});

test("theory state audit blocks unresolved theorem obligations and counterexamples", () => {
  const audited = auditTheoryStateObject({
    status: "draft",
    overall_signal: "yellow",
    thesis: "Margin-aware pseudo-labeling reduces assignment error.",
    theorem_issue_taxonomy: ["missing_assumption"],
    proof_obligations: [
      {
        obligation_id: "obl-1",
        issue_type: "missing_assumption",
        severity: "high",
        status: "open",
      },
    ],
    counterexample_red_team: {
      status: "needs_revision",
      blocking_findings: [
        {
          obligation_id: "cx-1",
          issue_type: "counterexample_found",
          severity: "critical",
          status: "open",
        },
      ],
    },
  });

  assert.equal(audited.ok, false);
  assert.match(audited.issues.join("\n"), /20 proof issue classes/);
  assert.match(audited.issues.join("\n"), /open high\/critical proof obligation/);
  assert.match(audited.issues.join("\n"), /counterexample_red_team/);
});

test("experiment launch decision audit rejects hollow decisions and accepts structured ones", () => {
  const hollow = auditExperimentLaunchDecisionObject({
    status: "pending_review",
    launch_approved: false,
  });
  const structured = auditExperimentLaunchDecisionObject({
    status: "revise",
    launch_approved: false,
    packet_fingerprint: "packet-1",
    track_ids: ["track-main"],
    claim_ids: ["claim-1"],
    blockers: ["Need one more falsifier."],
  });

  assert.equal(hollow.ok, false);
  assert.equal(structured.ok, true);
});

test("revision cycle audit requires the core pass structure", () => {
  const hollow = auditRevisionCycleObject({
    status: "ready",
    stage: "review",
    passes: {},
  });
  const structured = auditRevisionCycleObject({
    status: "ready",
    stage: "review",
    passes: {
      section_pass: { status: "required" },
      intro_method_consistency_pass: { status: "required" },
      full_paper_adversarial_pass: { status: "pending" },
    },
  });

  assert.equal(hollow.ok, false);
  assert.equal(structured.ok, true);
});
