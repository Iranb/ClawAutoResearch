import { asRecord, asStringArray, pickBoolean, pickString } from "./workflow-guard-core/coercion";

export type IntermediateArtifactAudit = {
  ok: boolean;
  issues: string[];
};

function collectMeaningfulLines(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^#{1,6}\s*$/.test(line) &&
        !/^[-*_]{3,}$/.test(line)
    );
}

function looksLikeStructuredBullet(line: string): boolean {
  return /^[-*]\s+\S+/.test(line) || /^\d+[.)]\s+\S+/.test(line);
}

function looksLikeSubstantiveSentence(line: string): boolean {
  return line.replace(/^[-*]\s+/, "").length >= 32;
}

function auditMarkdownStructure(params: {
  text: string | null | undefined;
  label: string;
  minimumMeaningfulLines: number;
  requireBulletOrSentence?: boolean;
}): IntermediateArtifactAudit {
  const lines = collectMeaningfulLines(params.text);
  const issues: string[] = [];
  if (lines.length < params.minimumMeaningfulLines) {
    issues.push(
      `${params.label} needs at least ${params.minimumMeaningfulLines} meaningful content line(s); found ${lines.length}.`
    );
  }
  if (
    params.requireBulletOrSentence !== false &&
    !lines.some((line) => looksLikeStructuredBullet(line) || looksLikeSubstantiveSentence(line))
  ) {
    issues.push(
      `${params.label} is present but still reads like a hollow stub; add concrete bullets or substantive prose.`
    );
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditFrontierReportText(
  text: string | null | undefined
): IntermediateArtifactAudit {
  return auditMarkdownStructure({
    text,
    label: "researcher/FRONTIER_REPORT.md",
    minimumMeaningfulLines: 2,
  });
}

export function auditIdeaReportText(
  text: string | null | undefined
): IntermediateArtifactAudit {
  return auditMarkdownStructure({
    text,
    label: "researcher/IDEA_REPORT.md",
    minimumMeaningfulLines: 2,
  });
}

export function auditIdeaAuditText(
  text: string | null | undefined
): IntermediateArtifactAudit {
  return auditMarkdownStructure({
    text,
    label: "researcher/IDEA_AUDIT.md",
    minimumMeaningfulLines: 1,
  });
}

export function auditTheoryStateObject(value: unknown): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const theoremCandidates = asStringArray(
    (record.theorem_candidates as Record<string, unknown>[] | undefined)?.map(
      (entry) => pickString(entry, ["statement", "title", "packet_id"]) ?? null
    ) ?? []
  );
  const lemmaPackets = asStringArray(
    (record.lemma_packets as Record<string, unknown>[] | undefined)?.map(
      (entry) => pickString(entry, ["statement", "title", "packet_id"]) ?? null
    ) ?? []
  );
  const appendixSections = asStringArray(
    (record.appendix_sections as Record<string, unknown>[] | undefined)?.map(
      (entry) => pickString(entry, ["title", "section_id", "path"]) ?? null
    ) ?? []
  );
  const issues: string[] = [];
  if (!pickString(record, ["status"])) {
    issues.push("analyzer/THEORY_STATE.json is missing status.");
  }
  if (!pickString(record, ["overall_signal"])) {
    issues.push("analyzer/THEORY_STATE.json is missing overall_signal.");
  }
  if (!pickString(record, ["thesis", "body_guidance"]) &&
      theoremCandidates.length === 0 &&
      lemmaPackets.length === 0 &&
      appendixSections.length === 0) {
    issues.push(
      "analyzer/THEORY_STATE.json is structurally present but hollow; add thesis/body guidance or theorem / lemma / appendix content."
    );
  }
  const taxonomy = asStringArray(
    record.theorem_issue_taxonomy ?? record.theoremIssueTaxonomy
  );
  if (taxonomy.length > 0 && taxonomy.length < 20) {
    issues.push(
      `analyzer/THEORY_STATE.json theorem_issue_taxonomy must cover 20 proof issue classes; found ${taxonomy.length}.`
    );
  }
  const proofObligations = Array.isArray(record.proof_obligations)
    ? record.proof_obligations
    : [];
  const openBlockingProofObligations = proofObligations.filter((entry) => {
    const obligation = asRecord(entry);
    if (!obligation) {
      return false;
    }
    const severity = pickString(obligation, ["severity"])?.toLowerCase();
    const status = pickString(obligation, ["status"])?.toLowerCase();
    return (
      (severity === "critical" || severity === "high") &&
      status !== "resolved" &&
      status !== "waived" &&
      status !== "closed"
    );
  });
  if (openBlockingProofObligations.length > 0) {
    issues.push(
      `analyzer/THEORY_STATE.json has ${openBlockingProofObligations.length} open high/critical proof obligation(s).`
    );
  }
  const counterexampleRedTeam = asRecord(
    record.counterexample_red_team ?? record.counterexampleRedTeam
  );
  const blockingFindings = Array.isArray(counterexampleRedTeam?.blocking_findings)
    ? counterexampleRedTeam.blocking_findings
    : [];
  if (blockingFindings.length > 0) {
    issues.push(
      `analyzer/THEORY_STATE.json counterexample_red_team has ${blockingFindings.length} blocking finding(s).`
    );
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditExperimentLaunchDecisionObject(
  value: unknown
): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const issues: string[] = [];
  if (!pickString(record, ["status"])) {
    issues.push("researcher/EXPERIMENT_LAUNCH_DECISION.json is missing status.");
  }
  if (pickBoolean(record, ["launch_approved", "launchApproved"]) == null) {
    issues.push(
      "researcher/EXPERIMENT_LAUNCH_DECISION.json must record launch_approved as a boolean."
    );
  }
  if (!pickString(record, ["packet_fingerprint", "packetFingerprint"])) {
    issues.push(
      "researcher/EXPERIMENT_LAUNCH_DECISION.json is missing packet_fingerprint."
    );
  }
  const trackIds = asStringArray(record.track_ids ?? record.trackIds);
  const claimIds = asStringArray(record.claim_ids ?? record.claimIds);
  const blockers = asStringArray(record.blockers);
  const actionItems = asStringArray(record.action_items ?? record.actionItems);
  if (
    trackIds.length === 0 &&
    claimIds.length === 0 &&
    blockers.length === 0 &&
    actionItems.length === 0
  ) {
    issues.push(
      "researcher/EXPERIMENT_LAUNCH_DECISION.json is too hollow; record target tracks / claims or explicit blockers / action items."
    );
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditRevisionCycleObject(value: unknown): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const passes = asRecord(record.passes) ?? {};
  const issues: string[] = [];
  if (!pickString(record, ["status"])) {
    issues.push("academic_writer/PAPER_REVISION_STATE.json is missing status.");
  }
  if (!pickString(record, ["stage"])) {
    issues.push("academic_writer/PAPER_REVISION_STATE.json is missing stage.");
  }
  for (const key of [
    "section_pass",
    "intro_method_consistency_pass",
    "full_paper_adversarial_pass",
  ]) {
    if (!asRecord(passes[key])) {
      issues.push(
        `academic_writer/PAPER_REVISION_STATE.json is missing passes.${key}.`
      );
    }
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditExperimentReasonablenessReportText(
  text: string | null | undefined
): IntermediateArtifactAudit {
  return auditMarkdownStructure({
    text,
    label: "analyzer/EXPERIMENT_REASONABLENESS_REPORT.md",
    minimumMeaningfulLines: 2,
  });
}

export function auditReviewPacketObject(value: unknown): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const issues: string[] = [];
  if (!pickString(record, ["status"])) {
    issues.push("reviewer/REVIEW_PACKET.json is missing status.");
  }
  if (!pickString(record, ["verdict"])) {
    issues.push("reviewer/REVIEW_PACKET.json is missing verdict.");
  }
  const actionItems = asStringArray(record.actionItems ?? record.action_items);
  const blockingArtifacts = asStringArray(
    record.blockingArtifacts ?? record.blocking_artifacts
  );
  if (actionItems.length === 0 && blockingArtifacts.length === 0) {
    issues.push(
      "reviewer/REVIEW_PACKET.json is too hollow; record concrete action items or blocking artifacts."
    );
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditDecompositionPacketObject(value: unknown): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const issues: string[] = [];
  const subproblems = Array.isArray(record.subproblems) ? record.subproblems : [];
  if (subproblems.length === 0) {
    issues.push("planner/DECOMPOSITION_PACKET.json must contain at least one subproblem.");
  }
  if (!pickString(record, ["status"])) {
    issues.push("planner/DECOMPOSITION_PACKET.json is missing status.");
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function auditAbstractionPacketObject(value: unknown): IntermediateArtifactAudit {
  const record = asRecord(value) ?? {};
  const issues: string[] = [];
  const patterns = Array.isArray(record.patterns) ? record.patterns : [];
  if (patterns.length === 0) {
    issues.push("planner/ABSTRACTION_PACKET.json must contain at least one pattern.");
  }
  if (!pickString(record, ["status"])) {
    issues.push("planner/ABSTRACTION_PACKET.json is missing status.");
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}
