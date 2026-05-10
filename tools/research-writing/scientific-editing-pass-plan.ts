import * as path from "node:path";
import {
  asRecord,
  pickBoolean,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH,
  DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH,
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";

type ScientificEditingPass = {
  pass_id: string;
  order: number;
  title: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  scope: string[];
  allowed_edits: string[];
  forbidden_edits: string[];
  prompt: string;
};

export type ScientificEditingPassPlanResult = {
  status: string;
  ledgerPath: string;
  reportPath: string;
  generatedFiles: string[];
  passes: ScientificEditingPass[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function buildPasses(params: {
  field: string | null;
  paperMode: string | null;
  evidencePacketPath: string | null;
}): ScientificEditingPass[] {
  const field = params.field ?? "the target research field";
  const mode = params.paperMode ?? "research paper";
  const evidencePacket =
    params.evidencePacketPath ?? "PaperNexus evidence packet and local evidence artifacts";
  return [
    {
      pass_id: "pass_1_structure",
      order: 1,
      title: "Structure and Story Arc",
      status: "pending",
      scope: ["section order", "paragraph roles", "claim progression"],
      allowed_edits: [
        "Reorder paragraphs when the local argument is incoherent.",
        "Add TODO markers for missing transitions or missing evidence.",
        "Compress duplicate motivation or background paragraphs.",
      ],
      forbidden_edits: [
        "Do not invent new claims, results, datasets, citations, or baselines.",
        "Do not change numerical results.",
      ],
      prompt:
        `Review the ${mode} as a structure editor for ${field}. Check whether the problem, gap, method, evidence, and limitation arc is visible section by section. Use ${evidencePacket} as the ceiling for factual claims. Produce only bounded edits, TODOs, and a ledger entry for unresolved evidence gaps.`,
    },
    {
      pass_id: "pass_2_argumentation",
      order: 2,
      title: "Argumentation and Evidence Boundary",
      status: "pending",
      scope: ["claim strength", "evidence mapping", "related-work positioning"],
      allowed_edits: [
        "Weaken unsupported claims.",
        "Replace vague novelty language with evidence-bounded contribution language.",
        "Move speculative implications into limitations or future work.",
      ],
      forbidden_edits: [
        "Do not upgrade metadata-supported evidence into graph-backed claims.",
        "Do not add citations from memory.",
      ],
      prompt:
        `Act as a skeptical scientific reviewer. For each strong claim, classify it as supported, partial, unsupported, or needs-search using ${evidencePacket}. Weaken or defer unsupported claims. Preserve metadata-only PaperNexus evidence as coverage context, not proof of fine-grained comparisons.`,
    },
    {
      pass_id: "pass_3_sentence_precision",
      order: 3,
      title: "Sentence Precision",
      status: "pending",
      scope: ["sentence clarity", "redundancy", "active voice", "local coherence"],
      allowed_edits: [
        "Rewrite unclear sentences for direct technical meaning.",
        "Remove filler phrases and redundant hedging.",
        "Improve transitions between adjacent sentences.",
      ],
      forbidden_edits: [
        "Do not change section structure.",
        "Do not alter equations, labels, citations, or numeric values except to flag obvious formatting mistakes.",
      ],
      prompt:
        "Rewrite only at sentence and paragraph-local level. Preserve all scientific meaning, labels, citation keys, equations, and numbers. Prefer precise verbs, concrete subjects, and short causal links over generic academic filler.",
    },
    {
      pass_id: "pass_4_grammar_terminology",
      order: 4,
      title: "Grammar and Terminology Consistency",
      status: "pending",
      scope: ["grammar", "field terminology", "notation naming", "capitalization"],
      allowed_edits: [
        "Fix grammar, agreement, article usage, and punctuation.",
        "Normalize terminology across title, abstract, method, experiments, and captions.",
        "Create TODOs for ambiguous terminology that needs author choice.",
      ],
      forbidden_edits: [
        "Do not introduce new technical terms without a definition.",
        "Do not change claim scope or experiment interpretation.",
      ],
      prompt:
        `Polish grammar and terminology for ${field}. Keep terminology stable across sections, figures, captions, and tables. When two terms appear to refer to the same concept, prefer one and record the normalization in the ledger.`,
    },
    {
      pass_id: "pass_5_typography_latex",
      order: 5,
      title: "Typography and LaTeX Consistency",
      status: "pending",
      scope: ["LaTeX commands", "math notation", "figure/table labels", "caption style"],
      allowed_edits: [
        "Fix obvious LaTeX syntax, label references, and caption formatting.",
        "Normalize notation presentation and symbol spacing.",
        "Flag unresolved figure placeholders and missing real-data figures.",
      ],
      forbidden_edits: [
        "Do not run or change repository citation, compile, or submit gates.",
        "Do not rewrite scientific claims while fixing typography.",
      ],
      prompt:
        "Audit LaTeX and typography only. Check labels, refs, equations, captions, tables, and placeholder figures. Produce manuscript edits or TODOs, but do not change citation/compile gate behavior.",
    },
    {
      pass_id: "pass_6_integrity_audit",
      order: 6,
      title: "Integrity Audit",
      status: "pending",
      scope: ["claim-evidence consistency", "citation identity", "numbers", "limitations"],
      allowed_edits: [
        "Flag claims that exceed available evidence.",
        "Flag citations, DOIs, author lists, or venues that need verification.",
        "Move overclaims into limitations or TODOs.",
      ],
      forbidden_edits: [
        "Do not invent missing citations or BibTeX entries.",
        "Do not change repository citation/compile/submit gate logic.",
      ],
      prompt:
        `Perform an integrity audit against ${evidencePacket}. Every factual claim, number, baseline, citation-backed comparison, and limitation must be supported or explicitly marked TODO. This pass produces manuscript edits, warnings, and ledger entries only; it does not run new citation/compile gate behavior.`,
    },
  ];
}

function renderReport(params: {
  passes: ScientificEditingPass[];
  ledgerPath: string;
  paperMode: string | null;
  evidencePacketPath: string | null;
}): string {
  return [
    "# Scientific Editing Pass Plan",
    "",
    `Status: planned`,
    `Paper mode: ${params.paperMode ?? "unset"}`,
    `Ledger: ${params.ledgerPath}`,
    `Evidence packet: ${params.evidencePacketPath ?? "PaperNexus/local evidence artifacts"}`,
    "",
    "## Operating Rule",
    "- Run passes in order and record each pass result in the ledger.",
    "- Later passes must not reopen earlier structural decisions unless they mark a blocker.",
    "- Pass 6 is an integrity audit only; this implementation does not modify citation, compile, or submit gates.",
    "",
    "## Passes",
    ...params.passes.flatMap((pass) => [
      `### ${pass.order}. ${pass.title}`,
      `- Status: ${pass.status}`,
      `- Scope: ${pass.scope.join(", ")}`,
      `- Prompt: ${pass.prompt}`,
      "",
    ]),
  ].join("\n");
}

export async function materializeScientificEditingPassPlan(params: {
  projectRoot: string;
  scientificEditingMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<ScientificEditingPassPlanResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const payload = params.scientificEditingMaterialization ?? {};
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const paperDesignIntake = asRecord(manifest.paper_design_intake) ?? {};
  const field =
    pickString(payload, ["field"]) ??
    pickString(paperDesignIntake, ["field", "subfield"]) ??
    null;
  const evidencePacketPath =
    pickString(payload, ["evidence_packet_path", "evidencePacketPath"]) ??
    "researcher/COVERAGE_SUMMARY.md";
  const ledgerPath =
    pickString(payload, ["ledger_path", "ledgerPath"]) ??
    writingContract.scientificEditingLedgerPath ??
    DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH;
  const reportPath =
    pickString(payload, ["report_path", "reportPath"]) ??
    writingContract.scientificEditingReportPath ??
    DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH;
  const passes = buildPasses({
    field,
    paperMode: writingContract.paperMode,
    evidencePacketPath,
  });
  const generatedAt = nowIso();
  const ledgerResolvedPath = resolveProjectArtifactPath(projectRoot, ledgerPath);
  const reportResolvedPath = resolveProjectArtifactPath(projectRoot, reportPath);
  if (!ledgerResolvedPath || !reportResolvedPath) {
    throw new Error("Unable to resolve scientific editing artifact paths.");
  }
  await writeJsonEnsured(ledgerResolvedPath, {
    schema_version: 1,
    status: "planned",
    generated_at: generatedAt,
    trigger: params.trigger ?? null,
    agent_id: params.agentId ?? null,
    evidence_packet_path: evidencePacketPath,
    passes,
    pass_results: [],
    completion_policy: {
      mark_ready_only_after_all_passes_completed: true,
      citation_compile_gates_modified: false,
    },
  });
  await writeTextEnsured(
    reportResolvedPath,
    renderReport({
      passes,
      ledgerPath,
      paperMode: writingContract.paperMode,
      evidencePacketPath,
    })
  );
  const required =
    pickBoolean(payload, ["required", "scientific_editing_required"]) ??
    writingContract.scientificEditingRequired ??
    true;
  manifest.writing_contract = serializeWritingContractState({
    ...writingContract,
    scientificEditingRequired: required,
    scientificEditingStatus: required ? "planned" : "optional",
    scientificEditingPasses: passes.map((pass) => pass.pass_id),
    scientificEditingLedgerPath: ledgerPath,
    scientificEditingReportPath: reportPath,
  });
  manifest.scientific_editing = {
    schema_version: 1,
    status: required ? "planned" : "optional",
    ledger_path: ledgerPath,
    report_path: reportPath,
    pass_count: passes.length,
    citation_compile_gates_modified: false,
    updated_at: generatedAt,
  };
  await writeJsonEnsured(manifestPath, manifest);
  return {
    status: required ? "planned" : "optional",
    ledgerPath,
    reportPath,
    generatedFiles: uniqueStrings([ledgerPath, reportPath]),
    passes,
  };
}
