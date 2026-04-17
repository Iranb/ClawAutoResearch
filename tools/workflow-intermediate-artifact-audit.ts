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
