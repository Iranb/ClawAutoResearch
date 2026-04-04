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
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

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
    pending_reason: pickString(record, ["pendingReason", "pending_reason"]),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

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
    pending_reason: state.pending_reason,
    updated_at: state.updated_at,
  };
}

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
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

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
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

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
