/**
 * 理论状态（Theory State）类型定义。
 *
 * 管理理论支持和形式化推导的状态——
 * TheoryObjectPacket 定义定理/引理的完整信息（statement、result、assumptions、
 * derivation outline、evidence pointers、caveats），
 * TheoryStateFile 管理所有 theorem candidates 和 lemma packets，
 * TheorySupportState 是运行时摘要（计数、就绪状态、待解决原因）。
 *
 * 为什么需要理论状态？因为论文中的理论推导需要严格管理——
 * 每个定理需要明确的假设、推导大纲、证据指针、注意事项，
 * 并且需要决定哪些内容放在正文、哪些放在附录。
 *
 * buildTheoryAppendixPlanMarkdown 和 buildTheoryAppendixSectionDraft
 * 用于生成理论附录的 Markdown 内容。
 */
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

const DEFAULT_THEORY_STATE_PATH = "analyzer/THEORY_STATE.json";
const DEFAULT_THEORY_NOTE_PATH = "analyzer/THEORY_SUPPORT_NOTE.md";
const DEFAULT_PROOF_PACKET_DIR = "analyzer/proof-packets";
const DEFAULT_THEORY_APPENDIX_PLAN_PATH = "academic_writer/THEORY_APPENDIX_PLAN.md";
const DEFAULT_PROOF_OBLIGATION_LEDGER_PATH =
  "analyzer/PROOF_OBLIGATION_LEDGER.json";
const DEFAULT_COUNTEREXAMPLE_RED_TEAM_REPORT_PATH =
  "analyzer/COUNTEREXAMPLE_RED_TEAM.md";

export const THEOREM_ISSUE_TAXONOMY = [
  "missing_assumption",
  "unstated_domain",
  "undefined_symbol",
  "quantifier_mismatch",
  "circular_reasoning",
  "invalid_implication",
  "gap_in_derivation",
  "lemma_dependency_missing",
  "condition_too_weak",
  "condition_too_strong",
  "boundary_case_failure",
  "counterexample_found",
  "asymptotic_claim_unjustified",
  "probability_statement_unsupported",
  "optimization_objective_mismatch",
  "notation_collision",
  "toy_setting_overgeneralized",
  "proof_scope_mismatch",
  "empirical_evidence_substituted_for_proof",
  "appendix_main_text_inconsistency",
];

type TheoryAppendixSectionLike = {
  section_id: string;
  title: string;
  purpose: string | null;
  packet_ids: string[];
};

type TheoryObjectPacketLike = {
  packet_id: string;
  role: string;
  title: string | null;
  statement: string;
  short_result: string | null;
  body_safe: boolean;
  confidence: string | null;
  appendix_required: boolean;
  appendix_path: string | null;
  evidence_pointers: string[];
  assumptions: string[];
  derivation_outline: string[];
  caveats: string[];
  notes: string | null;
  source_claim_ids: string[];
  updated_at: string | null;
};

type ProofObligationLike = {
  obligation_id: string;
  packet_id: string | null;
  issue_type: string;
  severity: string;
  status: string;
  finding: string | null;
  repair_owner_role: string | null;
  repair_hint: string | null;
  source_claim_ids: string[];
  updated_at: string | null;
};

type CounterexampleRedTeamAttemptLike = {
  attempt_id: string;
  packet_id: string | null;
  issue_type: string;
  status: string;
  candidate: string | null;
  expected_failure_mode: string | null;
  result: string | null;
  repaired_by: string | null;
  updated_at: string | null;
};

type CounterexampleRedTeamStateLike = {
  status: string;
  attempts: CounterexampleRedTeamAttemptLike[];
  blocking_findings: ProofObligationLike[];
  report_path: string | null;
  last_updated_at: string | null;
  pending_reason: string | null;
};

type TheoryStateFileLike = {
  schema_version: number;
  status: string;
  overall_signal: string | null;
  source_theory_note_path: string | null;
  thesis: string | null;
  body_guidance: string | null;
  main_text_proof_style: string | null;
  theorem_candidates: TheoryObjectPacketLike[];
  lemma_packets: TheoryObjectPacketLike[];
  appendix_sections: TheoryAppendixSectionLike[];
  theorem_issue_taxonomy: string[];
  proof_obligations: ProofObligationLike[];
  proof_obligation_ledger_path: string | null;
  counterexample_red_team: CounterexampleRedTeamStateLike;
  pending_reason: string | null;
  updated_at: string | null;
};

type TheorySupportStateLike = {
  status: string;
  overallSignal: string | null;
  theoryStatePath: string | null;
  sourceTheoryNotePath: string | null;
  proofPacketDir: string | null;
  appendixPacketPath: string | null;
  mainTextProofStyle: string | null;
  bodyReady: boolean;
  theoremCount: number;
  lemmaCount: number;
  proofPacketCount: number;
  proofObligationLedgerPath: string | null;
  proofObligationStatus: string;
  blockingProofIssueCount: number;
  counterexampleRedTeamStatus: string;
  counterexampleRedTeamReportPath: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

/**
 * 解析理论对象包（定理/引理）。
 *
 * statement 必须存在，否则返回 null（无效的理论对象）。
 * packetId 如果未提供则自动生成。
 */
export function normalizeTheoryObjectPacket(
  value: unknown
): TheoryObjectPacketLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const statement = pickString(record, ["statement"]);
  const packetId =
    pickString(record, ["packetId", "packet_id"]) ??
    pickString(record, ["lemmaId", "lemma_id"]) ??
    pickString(record, ["theoremId", "theorem_id"]);
  if (!packetId || !statement) {
    return null;
  }
  return {
    packet_id: packetId,
    role:
      pickString(record, ["role", "kind", "type"]) ??
      (packetId.startsWith("thm_") ? "theorem" : "lemma"),
    title: pickString(record, ["title", "name"]),
    statement,
    short_result: pickString(record, ["shortResult", "short_result", "result"]),
    body_safe: pickBoolean(record, ["bodySafe", "body_safe"]) ?? false,
    confidence: pickString(record, ["confidence", "signal"]),
    appendix_required:
      pickBoolean(record, ["appendixRequired", "appendix_required"]) ?? true,
    appendix_path: pickString(record, ["appendixPath", "appendix_path"]),
    evidence_pointers: asStringArray(
      record.evidencePointers ?? record.evidence_pointers
    ),
    assumptions: asStringArray(record.assumptions),
    derivation_outline: asStringArray(
      record.derivationOutline ?? record.derivation_outline
    ),
    caveats: asStringArray(record.caveats),
    notes: pickString(record, ["notes", "note"]),
    source_claim_ids: asStringArray(
      record.sourceClaimIds ?? record.source_claim_ids
    ),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

/**
 * 序列化理论对象包。
 */
export function serializeTheoryObjectPacket(
  packet: TheoryObjectPacketLike
): Record<string, unknown> {
  return {
    packet_id: packet.packet_id,
    role: packet.role,
    title: packet.title,
    statement: packet.statement,
    short_result: packet.short_result,
    body_safe: packet.body_safe,
    confidence: packet.confidence,
    appendix_required: packet.appendix_required,
    appendix_path: packet.appendix_path,
    evidence_pointers: packet.evidence_pointers,
    assumptions: packet.assumptions,
    derivation_outline: packet.derivation_outline,
    caveats: packet.caveats,
    notes: packet.notes,
    source_claim_ids: packet.source_claim_ids,
    updated_at: packet.updated_at,
  };
}

function normalizeTheoremIssueType(value: unknown): string {
  const normalized = normalizeStage(value);
  return normalized && THEOREM_ISSUE_TAXONOMY.includes(normalized)
    ? normalized
    : normalized ?? "missing_assumption";
}

export function normalizeProofObligation(
  value: unknown
): ProofObligationLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const obligationId = pickString(record, [
    "obligationId",
    "obligation_id",
    "issueId",
    "issue_id",
  ]);
  if (!obligationId) {
    return null;
  }
  return {
    obligation_id: obligationId,
    packet_id: pickString(record, ["packetId", "packet_id"]),
    issue_type: normalizeTheoremIssueType(
      record.issueType ?? record.issue_type ?? record.taxonomy
    ),
    severity:
      normalizeStage(record.severity) ??
      (normalizeStage(record.status) === "blocking" ? "high" : "medium"),
    status: normalizeStage(record.status) ?? "open",
    finding: pickString(record, ["finding", "description", "summary"]),
    repair_owner_role: pickString(record, [
      "repairOwnerRole",
      "repair_owner_role",
      "owner",
    ]),
    repair_hint: pickString(record, ["repairHint", "repair_hint"]),
    source_claim_ids: asStringArray(
      record.sourceClaimIds ?? record.source_claim_ids
    ),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

export function serializeProofObligation(
  obligation: ProofObligationLike
): Record<string, unknown> {
  return {
    obligation_id: obligation.obligation_id,
    packet_id: obligation.packet_id,
    issue_type: obligation.issue_type,
    severity: obligation.severity,
    status: obligation.status,
    finding: obligation.finding,
    repair_owner_role: obligation.repair_owner_role,
    repair_hint: obligation.repair_hint,
    source_claim_ids: obligation.source_claim_ids,
    updated_at: obligation.updated_at,
  };
}

function normalizeCounterexampleAttempt(
  value: unknown
): CounterexampleRedTeamAttemptLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const attemptId = pickString(record, ["attemptId", "attempt_id"]);
  if (!attemptId) {
    return null;
  }
  return {
    attempt_id: attemptId,
    packet_id: pickString(record, ["packetId", "packet_id"]),
    issue_type: normalizeTheoremIssueType(
      record.issueType ?? record.issue_type ?? record.taxonomy
    ),
    status: normalizeStage(record.status) ?? "pending",
    candidate: pickString(record, ["candidate", "counterexampleCandidate"]),
    expected_failure_mode: pickString(record, [
      "expectedFailureMode",
      "expected_failure_mode",
    ]),
    result: pickString(record, ["result"]),
    repaired_by: pickString(record, ["repairedBy", "repaired_by"]),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function serializeCounterexampleAttempt(
  attempt: CounterexampleRedTeamAttemptLike
): Record<string, unknown> {
  return {
    attempt_id: attempt.attempt_id,
    packet_id: attempt.packet_id,
    issue_type: attempt.issue_type,
    status: attempt.status,
    candidate: attempt.candidate,
    expected_failure_mode: attempt.expected_failure_mode,
    result: attempt.result,
    repaired_by: attempt.repaired_by,
    updated_at: attempt.updated_at,
  };
}

function normalizeCounterexampleRedTeamState(
  value: unknown
): CounterexampleRedTeamStateLike {
  const record = asRecord(value) ?? {};
  const blockingFindings = record.blockingFindings ?? record.blocking_findings;
  return {
    status: normalizeStage(record.status) ?? "pending",
    attempts: Array.isArray(record.attempts)
      ? record.attempts
          .map(normalizeCounterexampleAttempt)
          .filter(
            (
              entry: CounterexampleRedTeamAttemptLike | null
            ): entry is CounterexampleRedTeamAttemptLike => Boolean(entry)
          )
      : [],
    blocking_findings: Array.isArray(blockingFindings)
      ? blockingFindings
          .map(normalizeProofObligation)
          .filter(
            (entry: ProofObligationLike | null): entry is ProofObligationLike =>
              Boolean(entry)
          )
      : [],
    report_path:
      pickString(record, ["reportPath", "report_path"]) ??
      DEFAULT_COUNTEREXAMPLE_RED_TEAM_REPORT_PATH,
    last_updated_at: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pending_reason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeCounterexampleRedTeamState(
  state: CounterexampleRedTeamStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    attempts: state.attempts.map(serializeCounterexampleAttempt),
    blocking_findings: state.blocking_findings.map(serializeProofObligation),
    report_path: state.report_path,
    last_updated_at: state.last_updated_at,
    pending_reason: state.pending_reason,
  };
}

/**
 * 解析理论状态文件。
 *
 * 包含所有定理候选、引理包、附录章节计划。
 * schema_version 用于跟踪格式版本变化。
 */
export function normalizeTheoryStateFile(value: unknown): TheoryStateFileLike {
  const record = asRecord(value) ?? {};
  const theoremCandidates = Array.isArray(record.theorem_candidates)
    ? record.theorem_candidates.map(normalizeTheoryObjectPacket).filter(Boolean)
    : [];
  const lemmaPackets = Array.isArray(record.lemma_packets)
    ? record.lemma_packets.map(normalizeTheoryObjectPacket).filter(Boolean)
    : [];
  const appendixSections = Array.isArray(record.appendix_sections)
    ? record.appendix_sections
        .map((item) => {
          const section = asRecord(item);
          if (!section) {
            return null;
          }
          const sectionId = pickString(section, ["sectionId", "section_id"]);
          const title = pickString(section, ["title"]);
          if (!sectionId || !title) {
            return null;
          }
          return {
            section_id: sectionId,
            title,
            purpose: pickString(section, ["purpose"]),
            packet_ids: asStringArray(section.packetIds ?? section.packet_ids),
          } satisfies TheoryAppendixSectionLike;
        })
        .filter(Boolean)
    : [];
  const proofObligationsRaw = record.proofObligations ?? record.proof_obligations;
  const proofObligations = Array.isArray(proofObligationsRaw)
    ? proofObligationsRaw.map(normalizeProofObligation).filter(Boolean)
    : [];
  const taxonomy = asStringArray(
    record.theoremIssueTaxonomy ??
      record.theorem_issue_taxonomy ??
      record.proofIssueTaxonomy ??
      record.proof_issue_taxonomy
  );
  return {
    schema_version: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["schemaVersion", "schema_version"]) ?? 1
      )
    ),
    status: normalizeStage(record.status) ?? "missing",
    overall_signal: pickString(record, ["overallSignal", "overall_signal"]),
    source_theory_note_path:
      pickString(record, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
      DEFAULT_THEORY_NOTE_PATH,
    thesis: pickString(record, ["thesis"]),
    body_guidance: pickString(record, ["bodyGuidance", "body_guidance"]),
    main_text_proof_style:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    theorem_candidates: theoremCandidates as TheoryObjectPacketLike[],
    lemma_packets: lemmaPackets as TheoryObjectPacketLike[],
    appendix_sections: appendixSections as TheoryAppendixSectionLike[],
    theorem_issue_taxonomy:
      taxonomy.length > 0 ? taxonomy : [...THEOREM_ISSUE_TAXONOMY],
    proof_obligations: proofObligations as ProofObligationLike[],
    proof_obligation_ledger_path:
      pickString(record, [
        "proofObligationLedgerPath",
        "proof_obligation_ledger_path",
      ]) ?? DEFAULT_PROOF_OBLIGATION_LEDGER_PATH,
    counterexample_red_team: normalizeCounterexampleRedTeamState(
      record.counterexampleRedTeam ?? record.counterexample_red_team
    ),
    pending_reason: pickString(record, ["pendingReason", "pending_reason"]),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

/**
 * 序列化理论状态文件。
 */
export function serializeTheoryStateFile(
  state: TheoryStateFileLike
): Record<string, unknown> {
  return {
    schema_version: state.schema_version,
    status: state.status,
    overall_signal: state.overall_signal,
    source_theory_note_path: state.source_theory_note_path,
    thesis: state.thesis,
    body_guidance: state.body_guidance,
    main_text_proof_style: state.main_text_proof_style,
    theorem_candidates: state.theorem_candidates.map(serializeTheoryObjectPacket),
    lemma_packets: state.lemma_packets.map(serializeTheoryObjectPacket),
    appendix_sections: state.appendix_sections.map((section) => ({
      section_id: section.section_id,
      title: section.title,
      purpose: section.purpose,
      packet_ids: section.packet_ids,
    })),
    theorem_issue_taxonomy: state.theorem_issue_taxonomy,
    proof_obligations: state.proof_obligations.map(serializeProofObligation),
    proof_obligation_ledger_path: state.proof_obligation_ledger_path,
    counterexample_red_team: serializeCounterexampleRedTeamState(
      state.counterexample_red_team
    ),
    pending_reason: state.pending_reason,
    updated_at: state.updated_at,
  };
}

/**
 * 解析理论支持状态（运行时摘要）。
 *
 * 汇总理论状态——定理/引理数量、证明包数量、正文就绪状态。
 */
export function normalizeTheorySupportState(
  value: unknown
): TheorySupportStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    overallSignal: pickString(record, ["overallSignal", "overall_signal"]),
    theoryStatePath:
      pickString(record, ["theoryStatePath", "theory_state_path"]) ??
      DEFAULT_THEORY_STATE_PATH,
    sourceTheoryNotePath:
      pickString(record, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
      DEFAULT_THEORY_NOTE_PATH,
    proofPacketDir:
      pickString(record, ["proofPacketDir", "proof_packet_dir"]) ??
      DEFAULT_PROOF_PACKET_DIR,
    appendixPacketPath:
      pickString(record, ["appendixPacketPath", "appendix_packet_path"]) ??
      DEFAULT_THEORY_APPENDIX_PLAN_PATH,
    mainTextProofStyle:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    bodyReady: pickBoolean(record, ["bodyReady", "body_ready"]) ?? false,
    theoremCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["theoremCount", "theorem_count"]) ?? 0)
    ),
    lemmaCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["lemmaCount", "lemma_count"]) ?? 0)
    ),
    proofPacketCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["proofPacketCount", "proof_packet_count"]) ?? 0
      )
    ),
    proofObligationLedgerPath:
      pickString(record, [
        "proofObligationLedgerPath",
        "proof_obligation_ledger_path",
      ]) ?? DEFAULT_PROOF_OBLIGATION_LEDGER_PATH,
    proofObligationStatus:
      normalizeStage(
        record.proofObligationStatus ?? record.proof_obligation_status
      ) ?? "pending",
    blockingProofIssueCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "blockingProofIssueCount",
          "blocking_proof_issue_count",
        ]) ?? 0
      )
    ),
    counterexampleRedTeamStatus:
      normalizeStage(
        record.counterexampleRedTeamStatus ??
          record.counterexample_red_team_status
      ) ?? "pending",
    counterexampleRedTeamReportPath:
      pickString(record, [
        "counterexampleRedTeamReportPath",
        "counterexample_red_team_report_path",
      ]) ?? DEFAULT_COUNTEREXAMPLE_RED_TEAM_REPORT_PATH,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

/**
 * 序列化理论支持状态。
 */
export function serializeTheorySupportState(
  state: TheorySupportStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    overall_signal: state.overallSignal,
    theory_state_path: state.theoryStatePath,
    source_theory_note_path: state.sourceTheoryNotePath,
    proof_packet_dir: state.proofPacketDir,
    appendix_packet_path: state.appendixPacketPath,
    main_text_proof_style: state.mainTextProofStyle,
    body_ready: state.bodyReady,
    theorem_count: state.theoremCount,
    lemma_count: state.lemmaCount,
    proof_packet_count: state.proofPacketCount,
    proof_obligation_ledger_path: state.proofObligationLedgerPath,
    proof_obligation_status: state.proofObligationStatus,
    blocking_proof_issue_count: state.blockingProofIssueCount,
    counterexample_red_team_status: state.counterexampleRedTeamStatus,
    counterexample_red_team_report_path: state.counterexampleRedTeamReportPath,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

/**
 * 将理论对象包标签转换为可读文本。
 */
export function humanizeTheoryPacketLabel(
  value: string | null | undefined
): string {
  const raw = value?.trim();
  if (!raw) {
    return "Untitled theory packet";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

/**
 * 去重理论对象包列表（按 packet_id 去重）。
 */
export function dedupeTheoryPackets(
  packets: TheoryObjectPacketLike[]
): TheoryObjectPacketLike[] {
  const unique = new Map<string, TheoryObjectPacketLike>();
  for (const packet of packets) {
    if (!packet?.packet_id) {
      continue;
    }
    if (!unique.has(packet.packet_id)) {
      unique.set(packet.packet_id, packet);
    }
  }
  return Array.from(unique.values()).sort((left, right) => {
    const rank = (role: string) =>
      role === "theorem" || role === "proposition" || role === "corollary"
        ? 0
        : 1;
    const roleDelta = rank(left.role) - rank(right.role);
    if (roleDelta !== 0) {
      return roleDelta;
    }
    return (left.title ?? left.packet_id).localeCompare(
      right.title ?? right.packet_id
    );
  });
}

/**
 * 推断理论附录章节结构。
 *
 * 根据定理/引理包自动生成附录章节计划——
 * 将 body_safe=false 的包分组到附录章节。
 */
export function inferTheoryAppendixSections(params: {
  packets: TheoryObjectPacketLike[];
  existingSections: TheoryAppendixSectionLike[];
}): TheoryAppendixSectionLike[] {
  const appendixPackets = params.packets.filter(
    (packet) =>
      packet.appendix_required ||
      packet.derivation_outline.length > 0 ||
      packet.assumptions.length > 0 ||
      packet.caveats.length > 0
  );
  const appendixPacketIds = new Set(
    appendixPackets.map((packet) => packet.packet_id)
  );
  const sections: TheoryAppendixSectionLike[] = [];
  const seenSectionIds = new Set<string>();
  const coveredPacketIds = new Set<string>();

  for (const section of params.existingSections) {
    const packetIds = section.packet_ids.filter((packetId) =>
      appendixPacketIds.has(packetId)
    );
    if (packetIds.length === 0 || seenSectionIds.has(section.section_id)) {
      continue;
    }
    sections.push({
      section_id: section.section_id,
      title: section.title,
      purpose: section.purpose,
      packet_ids: packetIds,
    });
    seenSectionIds.add(section.section_id);
    for (const packetId of packetIds) {
      coveredPacketIds.add(packetId);
    }
  }

  for (const packet of appendixPackets) {
    if (coveredPacketIds.has(packet.packet_id)) {
      continue;
    }
    const title = packet.title ?? humanizeTheoryPacketLabel(packet.packet_id);
    const sectionId = `appendix_${packet.packet_id}`;
    if (seenSectionIds.has(sectionId)) {
      continue;
    }
    sections.push({
      section_id: sectionId,
      title,
      purpose: `Detailed ${packet.role} derivation and boundary conditions for ${title}.`,
      packet_ids: [packet.packet_id],
    });
    seenSectionIds.add(sectionId);
  }

  return sections;
}

export function escapeLatexText(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function sanitizeLatexLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9:-]+/g, "-");
}

export function renderMarkdownList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderLatexItemList(items: string[]): string {
  if (items.length === 0) {
    return "\\begin{itemize}\n\\item None.\n\\end{itemize}";
  }
  return [
    "\\begin{itemize}",
    ...items.map((item) => `\\item ${escapeLatexText(item)}`),
    "\\end{itemize}",
  ].join("\n");
}

/**
 * 构建理论附录计划的 Markdown 内容。
 *
 * 生成包含所有章节标题、目的、包含的理论对象的 Markdown 文档。
 */
export function buildTheoryAppendixPlanMarkdown(params: {
  theoryFile: TheoryStateFileLike;
  packets: TheoryObjectPacketLike[];
  appendixSections: TheoryAppendixSectionLike[];
  appendixSectionPath: string;
}): string {
  const bodySafePackets = params.packets.filter((packet) => packet.body_safe);
  const appendixOnlyPackets = params.packets.filter((packet) => !packet.body_safe);
  const lines: string[] = [
    "# Theory Appendix Plan",
    "",
    "## Synthesis Summary",
    `- Overall signal: ${(params.theoryFile.overall_signal ?? "unknown").toUpperCase()}`,
    `- Thesis: ${params.theoryFile.thesis ?? "Not yet stated"}`,
    `- Main-text proof style: ${params.theoryFile.main_text_proof_style ?? "lemma_result_only"}`,
    `- Body-safe packets: ${bodySafePackets.length}`,
    `- Appendix sections: ${params.appendixSections.length}`,
    `- Appendix draft path: ${params.appendixSectionPath}`,
    "",
    "## Main-Text Safe Statements",
  ];

  if (bodySafePackets.length === 0) {
    lines.push(
      "- No packet is currently body-safe. Keep theory discussion in mechanism / appendix language until stronger support exists."
    );
  } else {
    for (const packet of bodySafePackets) {
      lines.push(`### ${packet.title ?? humanizeTheoryPacketLabel(packet.packet_id)}`);
      lines.push(`- Packet ID: ${packet.packet_id}`);
      lines.push(`- Role: ${packet.role}`);
      lines.push(`- Statement: ${packet.statement}`);
      if (packet.short_result) {
        lines.push(`- Main-text result: ${packet.short_result}`);
      }
      lines.push(
        `- Evidence basis:\n${renderMarkdownList(packet.evidence_pointers, "Use the paired empirical evidence from the analyzer report.")}`
      );
      lines.push(
        `- Assumptions:\n${renderMarkdownList(packet.assumptions, "State assumptions conservatively in prose.")}`
      );
      lines.push(
        `- Caveats:\n${renderMarkdownList(packet.caveats, "No extra caveat recorded yet.")}`
      );
      lines.push("");
    }
  }

  lines.push("## Appendix Sections");
  if (params.appendixSections.length === 0) {
    lines.push("- No appendix section is required yet.");
  } else {
    for (const section of params.appendixSections) {
      const packets = section.packet_ids
        .map((packetId) =>
          params.packets.find((packet) => packet.packet_id === packetId)
        )
        .filter(Boolean) as TheoryObjectPacketLike[];
      lines.push(`### ${section.title}`);
      if (section.purpose) {
        lines.push(`- Purpose: ${section.purpose}`);
      }
      lines.push(`- Packet IDs: ${section.packet_ids.join(", ")}`);
      for (const packet of packets) {
        lines.push(`- ${packet.role}: ${packet.statement}`);
        if (packet.derivation_outline.length > 0) {
          lines.push(
            `  - Derivation outline:\n${packet.derivation_outline
              .map((item) => `    - ${item}`)
              .join("\n")}`
          );
        }
      }
      lines.push("");
    }
  }

  lines.push("## Non-Body-Safe / Exploratory Packets");
  if (appendixOnlyPackets.length === 0) {
    lines.push("- None.");
  } else {
    for (const packet of appendixOnlyPackets) {
      lines.push(`- ${packet.packet_id}: ${packet.statement}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/**
 * 生成单个理论附录章节的草稿。
 *
 * 将定理/引理包转换为 LaTeX 格式的附录章节——
 * 包含标题、陈述、假设、推导大纲、注意事项。
 */
export function buildTheoryAppendixSectionDraft(params: {
  theoryFile: TheoryStateFileLike;
  packets: TheoryObjectPacketLike[];
  appendixSections: TheoryAppendixSectionLike[];
}): string {
  const sections: string[] = [
    "% Auto-generated theory appendix draft from THEORY_STATE.json and proof packets.",
    "\\section{Additional Theory and Derivation Details}",
    "\\label{app:theory}",
    "",
    "This appendix expands the theorem and lemma sketches referenced in the main text.",
    "",
  ];

  for (const section of params.appendixSections) {
    sections.push(`\\subsection{${escapeLatexText(section.title)}}`);
    sections.push(`\\label{sec:${sanitizeLatexLabel(section.section_id)}}`);
    if (section.purpose) {
      sections.push(escapeLatexText(section.purpose));
      sections.push("");
    }
    const packets = section.packet_ids
      .map((packetId) =>
        params.packets.find((packet) => packet.packet_id === packetId)
      )
      .filter(Boolean) as TheoryObjectPacketLike[];
    for (const packet of packets) {
      sections.push(
        `\\paragraph{${escapeLatexText(humanizeTheoryPacketLabel(packet.role))}: ${escapeLatexText(packet.title ?? humanizeTheoryPacketLabel(packet.packet_id))}}`
      );
      sections.push(escapeLatexText(packet.statement));
      sections.push("");
      if (packet.short_result) {
        sections.push(
          `\\textbf{Result connection.} ${escapeLatexText(packet.short_result)}`
        );
        sections.push("");
      }
      sections.push("\\textbf{Assumptions.}");
      sections.push(renderLatexItemList(packet.assumptions));
      sections.push("");
      sections.push("\\textbf{Derivation sketch.}");
      if (packet.derivation_outline.length === 0) {
        sections.push(
          "\\begin{enumerate}\n\\item Expand this derivation from the structured packet before submission.\n\\end{enumerate}"
        );
      } else {
        sections.push(
          [
            "\\begin{enumerate}",
            ...packet.derivation_outline.map(
              (item) => `\\item ${escapeLatexText(item)}`
            ),
            "\\end{enumerate}",
          ].join("\n")
        );
      }
      sections.push("");
      sections.push("\\textbf{Evidence links.}");
      sections.push(renderLatexItemList(packet.evidence_pointers));
      sections.push("");
      sections.push("\\textbf{Caveats.}");
      sections.push(renderLatexItemList(packet.caveats));
      sections.push("");
    }
  }

  if (params.appendixSections.length === 0) {
    sections.push(
      "No appendix-only theorem or lemma packet is currently available. Keep theoretical discussion conservative."
    );
    sections.push("");
  }

  return `${sections.join("\n").trim()}\n`;
}
